import { createRequire } from "node:module";
import { Connection, PublicKey } from "@solana/web3.js";
import { rpcUrl } from "../chain";
import { feeHistory } from "./fee-history.ts";
// Every coin launched here, stored in Redis: the list behind /tokens, each coin's page,
// and each pump user's coins. Lifetime creator fees are totalled from the coin's creator
// vault, which levels up its floor and pays the recipient game cash.
import { getJson, hasDb, pipeline, redis, setJson } from "../redis";
import { feeTier } from "./model";
import { squadCoinByMint } from "../king/store";

export type Profile = { wallet: string; username: string | null; image: string | null; x: string | null; followers: number | null };

export type Coin = {
  mint: string;
  name: string;
  ticker: string;
  description: string;
  twitter: string;
  telegram: string;
  recipient: Profile;
  launcher: string;
  signature: string;
  createdAt: number;
};

export type CoinView = Coin & { feesSol: number; recipientSol: number; tier: number; pendingSol?: number; mcapUsd?: number | null; volUsd?: number | null };

/** One pump user across every coin launched for them, for the profiles list. */
export type ProfileSummary = {
  profile: Profile;
  coins: number;
  feesSol: number;
  earnedSol: number;
  mcapUsd: number;
  /** 24h trading volume across their coins, in USD. */
  volUsd: number;
  top: { mint: string; ticker: string; mcapUsd: number | null };
  /** Their newest coins, for the logo strip on their card. */
  recent: { mint: string; ticker: string }[];
  latest: number;
};

const k = {
  coin: (m: string) => `pt:coin:${m}`,
  all: "pt:coins",
  by: (w: string) => `pt:coins:to:${w}`,
  launched: (w: string) => `pt:coins:by:${w}`,
  fees: (m: string) => `pt:coin:fees:v2:${m}`,
  image: (m: string) => `pt:img:${m}`,
  meta: (m: string) => `pt:meta:${m}`,
};
export const assetKeys = { image: k.image, meta: k.meta };

/** A draft's image and metadata live for a day; launching keeps them for good. */
export const DRAFT_TTL = 86_400;

export async function saveCoin(c: Coin) {
  await pipeline([
    ["SET", k.coin(c.mint), JSON.stringify(c)],
    ["ZADD", k.all, c.createdAt, c.mint],
    ["ZADD", k.by(c.recipient.wallet), c.createdAt, c.mint],
    ["ZADD", k.launched(c.launcher), c.createdAt, c.mint],
    ["PERSIST", k.image(c.mint)],
    ["PERSIST", k.meta(c.mint)],
  ]);
}

export const getCoin = (mint: string) => getJson<Coin>(k.coin(mint));

type FeeTally = { sol: number; last: string | null; at: number };
const require = createRequire(import.meta.url);
const sdk = require("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
const { EventParser } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");

/** Finalized receipts avoid enhanced-transaction indexer lag after a worker claim. */
export async function paidOut(mint: string, vault: string, force = false, requiredSignature?: string): Promise<number> {
  const raw = await redis<string | null>("GET", k.fees(mint));
  const prev: FeeTally | null = raw ? JSON.parse(raw) : null;
  if (!force && prev && Date.now() - prev.at < 10 * 60_000) return prev.sol;
  try {
    const conn = new Connection(rpcUrl(), "finalized");
    const launch = await getCoin(mint) ?? await squadCoinByMint(mint);
    const parser = new EventParser(sdk.PUMP_PROGRAM_ID, sdk.getPumpProgram(conn).coder);
    const history = await feeHistory(prev?.last ?? null, {
      requiredSignature,
      page: (before) => conn.getSignaturesForAddress(new PublicKey(vault), { limit: 50, before }, "finalized"),
      amount: async (signature) => {
        // The registered atomic create has no pre-existing fees to pay out. Its
        // long creation logs can be truncated; it is not a payout receipt.
        if (signature === launch?.signature) return 0n;
        // Read receipt JSON directly: web3.js's message decoder only supports v0,
        // while a vault's history can also contain newer transaction versions.
        const response = await fetch(rpcUrl(), {
          method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
          signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 1 }] }),
        });
        if (!response.ok) throw Error(`Fee receipt HTTP ${response.status}`);
        const result = await response.json() as { error?: { code?: number }; result?: { meta?: { err: unknown; logMessages: string[] | null } } };
        if (result.error) throw Error(`Fee receipt RPC code ${result.error.code}`);
        const tx = result.result;
        if (!tx?.meta || !tx.meta.logMessages || tx.meta.logMessages.some(l => /log truncated/i.test(l))) throw Error("Finalized fee receipt unavailable");
        if (tx.meta.err) return 0n;
        let amount = 0n;
        for (const event of parser.parseLogs(tx.meta.logMessages)) {
          if (event.name !== "distributeCreatorFeesEvent") continue;
          const e = event.data as unknown as import("@pump-fun/pump-sdk").DistributeCreatorFeesEvent;
          if (e.mint.toBase58() === mint && sdk.creatorVaultPda(e.sharingConfig).toBase58() === vault) amount += BigInt(e.distributed.toString());
        }
        return amount;
      },
    });
    const next: FeeTally = { sol: (prev?.sol ?? 0) + Number(history.lamports) / 1e9, last: history.last, at: Date.now() };
    // A slow request cannot overwrite a refresh or invalidation from a newer claim.
    const saved = await redis<number>("EVAL", "if (redis.call('GET',KEYS[1]) or '')~=ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2]) return 1", 1, k.fees(mint), raw ?? "", JSON.stringify(next));
    if (!saved) {
      if (force) return paidOut(mint, vault, true, requiredSignature);
      return (await getJson<FeeTally>(k.fees(mint)))?.sol ?? next.sol;
    }
    return next.sol;
  } catch (e) {
    if (force) throw e;
    console.error("coin fee receipt refresh failed", { mint, cached: prev?.sol ?? null, reason: e instanceof Error && /^(Fee |Finalized |Claim |redis )/.test(e.message) ? e.message : e instanceof Error ? e.name : "unknown" });
    return prev?.sol ?? 0;
  }
}

/** Keep the cursor and cumulative total; invalidate freshness, then refill from chain. */
export async function refreshClaimedFees(mint: string, signature: string) {
  await redis("EVAL", "local v=redis.call('GET',KEYS[1]); if v then local s=cjson.decode(v); s.at=0; redis.call('SET',KEYS[1],cjson.encode(s)); end return 1", 1, k.fees(mint));
  await paidOut(mint, sdk.creatorVaultPda(sdk.feeSharingConfigPda(new PublicKey(mint))).toBase58(), true, signature);
  await redis("DEL", "pt:treasury:txs");
}

/** Lifetime fees include what's still waiting in the vault, so a floor levels up before anyone pays out. */
export function view(c: Coin, paid: number, pending = 0): CoinView {
  const feesSol = paid + pending;
  return { ...c, feesSol, recipientSol: (feesSol * 8) / 10, tier: feeTier(feesSol), pendingSol: pending };
}

async function coinsAt(key: string, start: number, count: number): Promise<Coin[]> {
  if (!hasDb()) return [];
  const mints = await redis<string[]>("ZREVRANGE", key, start, start + count - 1);
  if (!mints.length) return [];
  const raw = await redis<(string | null)[]>("MGET", ...mints.map(k.coin));
  return raw.flatMap((r) => (r ? [JSON.parse(r) as Coin] : []));
}

export const latestCoins = (start = 0, count = 30) => coinsAt(k.all, start, count);
export const coinsFor = (wallet: string) => coinsAt(k.by(wallet), 0, 100);
export const coinsLaunchedBy = (wallet: string) => coinsAt(k.launched(wallet), 0, 100);
/** How many coins were launched for each wallet, in the same order. */
export async function coinCountsFor(wallets: string[]): Promise<number[]> {
  if (!hasDb() || !wallets.length) return wallets.map(() => 0);
  return (await pipeline(wallets.map((w) => ["ZCARD", k.by(w)]))).map((n) => Number(n) || 0);
}
export const coinCount = () => (hasDb() ? redis<number>("ZCARD", k.all) : Promise.resolve(0));
