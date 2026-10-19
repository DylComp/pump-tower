// Every coin launched here, stored in Redis: the list behind /tokens, each coin's page,
// and each pump user's coins. Lifetime creator fees are totalled from the coin's creator
// vault, which levels up its floor and pays the recipient game cash.
import { getJson, hasDb, pipeline, redis, setJson } from "../redis";
import { feeTier } from "./model";

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

export type CoinView = Coin & { feesSol: number; recipientSol: number; tier: number; pendingSol?: number; mcapUsd?: number | null };

const k = {
  coin: (m: string) => `pt:coin:${m}`,
  all: "pt:coins",
  by: (w: string) => `pt:coins:to:${w}`,
  launched: (w: string) => `pt:coins:by:${w}`,
  fees: (m: string) => `pt:coin:fees:${m}`,
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
type Tx = { signature: string; nativeTransfers?: { fromUserAccount: string; amount: number }[] };

/** SOL paid out of the coin's creator vault so far (to both shareholders), refreshed every 10 minutes. */
export async function paidOut(mint: string, vault: string): Promise<number> {
  const prev = await getJson<FeeTally>(k.fees(mint)).catch(() => null);
  if (prev && Date.now() - prev.at < 10 * 60_000) return prev.sol;
  const api = process.env.HELIUS_API_KEY;
  if (!api) return prev?.sol ?? 0;
  try {
    let lamports = 0;
    let newest: string | null = null;
    let before: string | undefined;
    outer: for (let page = 0; page < 5; page++) {
      const url = new URL(`https://api.helius.xyz/v0/addresses/${vault}/transactions`);
      url.searchParams.set("api-key", api);
      url.searchParams.set("limit", "100");
      if (before) url.searchParams.set("before", before);
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw Error(`helius ${res.status}`);
      const txs = (await res.json()) as Tx[];
      if (!txs.length) break;
      newest ??= txs[0].signature;
      for (const tx of txs) {
        if (tx.signature === prev?.last) break outer;
        for (const t of tx.nativeTransfers ?? []) if (t.fromUserAccount === vault) lamports += t.amount;
      }
      before = txs[txs.length - 1].signature;
      if (txs.length < 100) break;
    }
    const next: FeeTally = { sol: (prev?.sol ?? 0) + lamports / 1e9, last: newest ?? prev?.last ?? null, at: Date.now() };
    await setJson(k.fees(mint), next);
    return next.sol;
  } catch (e) {
    console.error("coin fees", e);
    return prev?.sol ?? 0;
  }
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
export const coinCount = () => (hasDb() ? redis<number>("ZCARD", k.all) : Promise.resolve(0));
