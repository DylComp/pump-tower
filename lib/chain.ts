// Server-only: reads a wallet's SPL holdings and how long each has been held.
// Read-only RPC calls; nothing here signs or sends a transaction.
import { HOUSE_SYMBOL, isHouseMint, type Floor } from "./game";

const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];
const SIG_PAGE = 1000;
const RPC_TIMEOUT_MS = 8000;
const MAX_FLOORS = 24;
const MIN_USD = 0.5;

export function rpcUrl() {
  if (process.env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  // PublicNode is free and keyless, and far more forgiving than api.mainnet-beta for these calls.
  return process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    const json = await res.json();
    if (json.error) throw new Error(`${method}: ${json.error.message}`);
    return json.result as T;
  }
}

/** JSON-RPC batch: one round trip for many calls. Failed entries come back null. */
async function rpcBatch<T>(method: string, paramsList: unknown[][]): Promise<(T | null)[]> {
  if (!paramsList.length) return [];
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(paramsList.map((params, id) => ({ jsonrpc: "2.0", id, method, params }))),
      cache: "no-store",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (res.status !== 429 || attempt >= 2) break;
    await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
  const json = (await res.json()) as { id: number; result?: T }[];
  if (!Array.isArray(json)) throw new Error(`${method}: batch not supported`);
  const out: (T | null)[] = new Array(paramsList.length).fill(null);
  for (const r of json) out[r.id] = r.result ?? null;
  return out;
}

type ParsedAccount = {
  pubkey: string;
  account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null; decimals: number } } } } };
};

type Holding = { account: string; mint: string; amount: number };

async function holdings(owner: string): Promise<Holding[]> {
  const out: Holding[] = [];
  for (const programId of TOKEN_PROGRAMS) {
    const r = await rpc<{ value: ParsedAccount[] }>("getTokenAccountsByOwner", [
      owner,
      { programId },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);
    for (const a of r.value) {
      const info = a.account.data.parsed.info;
      const amt = info.tokenAmount.uiAmount ?? 0;
      // Skip empty accounts and NFTs (0 decimals).
      if (amt > 0 && info.tokenAmount.decimals > 0) out.push({ account: a.pubkey, mint: info.mint, amount: amt });
    }
  }
  return out;
}

type ParsedTx = {
  blockTime: number | null;
  meta: {
    err: unknown;
    preTokenBalances?: { accountIndex: number; uiTokenAmount: { uiAmount: number | null } }[];
    postTokenBalances?: { accountIndex: number; uiTokenAmount: { uiAmount: number | null } }[];
  } | null;
  transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } };
};

const SCAN_BATCH = 10;
const SCAN_MAX = 30;

function balanceAt(list: { accountIndex: number; uiTokenAmount: { uiAmount: number | null } }[] | undefined, i: number) {
  return list?.find((b) => b.accountIndex === i)?.uiTokenAmount.uiAmount ?? 0;
}

/**
 * When the current bag started: the latest transaction where this token
 * account went from empty to holding. Selling everything and buying back
 * restarts the clock. If the account is too busy to scan to that point, the
 * oldest signature seen is used, which can only make the hold look shorter.
 */
async function heldSince(account: string): Promise<number | null> {
  const keyed = !!(process.env.HELIUS_API_KEY || process.env.SOLANA_RPC_URL);
  const sigs: { signature: string; blockTime: number | null; err: unknown }[] = [];
  let before: string | undefined;
  for (let page = 0; page < (keyed ? 3 : 1); page++) {
    const batch = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>("getSignaturesForAddress", [
      account,
      { limit: SIG_PAGE, ...(before ? { before } : {}) },
    ]);
    sigs.push(...batch);
    if (batch.length < SIG_PAGE) break;
    before = batch[batch.length - 1].signature;
  }
  if (!sigs.length) return null;
  const oldest = sigs[sigs.length - 1].blockTime;
  const fallback = oldest ? oldest * 1000 : null;
  if (sigs.length === 1) return fallback;

  const ok = sigs.filter((s) => !s.err).slice(0, SCAN_MAX);
  try {
    for (let i = 0; i < ok.length; i += SCAN_BATCH) {
      const txs = await rpcBatch<ParsedTx>(
        "getTransaction",
        ok.slice(i, i + SCAN_BATCH).map((s) => [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]),
      );
      for (const tx of txs) {
        if (!tx?.meta || tx.meta.err || !tx.blockTime) continue;
        const idx = tx.transaction.message.accountKeys.findIndex((k) => (typeof k === "string" ? k : k.pubkey) === account);
        if (idx < 0) continue;
        if (balanceAt(tx.meta.preTokenBalances, idx) === 0 && balanceAt(tx.meta.postTokenBalances, idx) > 0) return tx.blockTime * 1000;
      }
    }
  } catch {
    // RPC without batch support or a slow node: fall back to the first signature.
  }
  return fallback;
}

type DexPair = {
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  info?: { imageUrl?: string };
  priceChange?: { h24?: number };
  marketCap?: number;
  fdv?: number;
};

type Meta = { symbol: string; name: string; image: string | null; price: number | null; change24: number | null; mcap: number | null };

async function metadata(mints: string[]): Promise<Map<string, Meta>> {
  const out = new Map<string, Meta>();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`, {
        next: { revalidate: 120 },
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const pairs = (await res.json()) as DexPair[];
      // Keep the most liquid pair per token.
      const best = new Map<string, DexPair>();
      for (const p of pairs) {
        const prev = best.get(p.baseToken.address);
        if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) best.set(p.baseToken.address, p);
      }
      for (const [mint, p] of best) {
        out.set(mint, {
          symbol: p.baseToken.symbol,
          name: p.baseToken.name,
          image: p.info?.imageUrl ?? null,
          price: p.priceUsd ? Number(p.priceUsd) : null,
          change24: p.priceChange?.h24 ?? null,
          mcap: p.marketCap ?? p.fdv ?? null,
        });
      }
    } catch {
      // Metadata is decoration; a failed batch just leaves those floors unlabeled.
    }
  }
  return out;
}

/** Market cap in USD for each mint DexScreener knows, read from its most liquid pair. */
export async function marketCaps(mints: string[]): Promise<Map<string, number | null>> {
  const meta = await metadata(mints);
  return new Map(mints.map((m) => [m, meta.get(m)?.mcap ?? null]));
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export const isAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export async function buildTower(owner: string): Promise<Floor[]> {
  const held = await holdings(owner);
  const meta = await metadata([...new Set(held.map((h) => h.mint))]);

  const candidates = held
    .map((h) => {
      const m = meta.get(h.mint);
      const usd = m?.price != null ? m.price * h.amount : null;
      return { h, m, usd, isHouse: isHouseMint(h.mint) };
    })
    // Unlisted tokens are usually spam airdrops; dust does not get a floor.
    .filter((c) => c.isHouse || (c.m && (c.usd ?? 0) >= MIN_USD))
    .sort((a, b) => Number(b.isHouse) - Number(a.isHouse) || (b.usd ?? 0) - (a.usd ?? 0))
    .slice(0, MAX_FLOORS);

  const since = await pool(candidates, 8, (c) => heldSince(c.h.account).catch(() => null));

  return candidates.map((c, i) => ({
    mint: c.h.mint,
    symbol: c.isHouse ? HOUSE_SYMBOL : (c.m?.symbol ?? c.h.mint.slice(0, 4)).trim(),
    name: c.isHouse ? "Pump Tower" : (c.m?.name ?? "unknown").trim(),
    image: c.m?.image ?? null,
    amount: c.h.amount,
    usd: c.usd,
    heldSince: since[i],
    isHouse: c.isHouse,
    change24: c.m?.change24 ?? null,
    mcap: c.m?.mcap ?? null,
  }));
}
