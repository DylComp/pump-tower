// King of the Hill rules shared by the server, the cron and the pages. No chain or node code.
// Every squad in pump.fun's Squad Invitational gets an unofficial fan coin. Its creator fees
// are split on chain: half to the treasury (the King pot), half to the squad's
// members. Each hour the squad whose members banked the most SOL from trading (measured on
// chain from their wallets) is King, and the pot pays holders of the King's coin in SOL.
import { SITE_URL } from "../site.ts";

/** pump.fun's Squad Invitational, Oct 26 to Nov 9 2026 at 14:00 UTC. */
export const COMPETITION_ID = "f0f80f25-3b5c-4996-8750-7940f6950965";
export const COMPETITION_ENDS = Date.parse("2026-11-09T14:00:00Z");

/** Creator-fee split: the treasury funds the King pot, members share the rest equally. */
export const POT_BPS = 5000;
/** pump.fun allows 10 shareholders, and 8 members keep the launch inside one transaction. */
export const MAX_MEMBERS = 8;
/** Of each hour's pot: holders of the King's coin, then $PTWR buy-and-burn. */
export const HOLDERS_BPS = 8000;
/** Holders paid per hour, largest first, so one hour is a bounded number of transfers. */
export const MAX_PAYEES = 200;
/** Smaller payouts roll into the next hour instead of costing more than they're worth. */
export const MIN_PAYOUT_LAMPORTS = 1_000_000n;

export const HOUR = 3_600_000;
export const hourOf = (ms: number) => Math.floor(ms / HOUR) * HOUR;
export const hourId = (ms: number) => new Date(hourOf(ms)).toISOString().slice(0, 13) + "Z";

/**
 * One squad: who it is (pump's board, read once when the cup started; membership is locked
 * for the cup) and the SOL its members banked, read from their wallets on chain. Banked
 * numbers are SOL, and null for squads without a coin, which aren't tracked.
 */
export type Squad = {
  groupId: string;
  name: string;
  image: string | null;
  rank: number;
  members: number;
  struck: boolean;
  bankedHour: number | null;
  bankedLast: number | null;
  bankedTotal: number | null;
};

export type Member = { wallet: string; username: string | null; role: string; joinedAt: number; inCompetition: boolean };

/** A squad's fan coin, as launched. `shares` is the on-chain split, treasury included. */
export type SquadCoin = {
  mint: string;
  groupId: string;
  squad: string;
  name: string;
  ticker: string;
  image: string | null;
  shares: { address: string; shareBps: number }[];
  members: Member[];
  launcher: string;
  signature: string;
  createdAt: number;
};

/** A squad name in the URL: pump usernames are letters, numbers and underscores. */
export const squadSlug = (name: string) => name.trim().toLowerCase();
export const squadPage = (name: string) => `${SITE_URL}/king/${encodeURIComponent(squadSlug(name))}`;

/** Squad names with slurs never get a coin carrying the site's link. */
const SLURS = /n[i1]gg|jew|(^|[^g])rape|retard|fag/i;
export const launchable = (squad: string) => !SLURS.test(squad);

export function coinName(squad: string) {
  const name = `${squad.trim()} squad`;
  return new TextEncoder().encode(name).length <= 32 ? name : squad.trim().slice(0, 32);
}

export function coinTicker(squad: string) {
  const t = squad.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return t || "SQUAD";
}

export const coinDescription = (squad: string) =>
  `Unofficial fan coin for the ${squad} squad in pump.fun's Squad Invitational. Not affiliated with the squad or pump.fun. ` +
  `Half of creator fees go to ${squad}'s members, half to the King of the Hill pot: every hour the squad whose members bank the most SOL is King, and holders of its coin are paid in SOL.`;

/** The members who get fees: the owner first, then by join date, at most MAX_MEMBERS, no duplicates. */
export function payees(members: Member[], treasury: string): Member[] {
  const seen = new Set([treasury]);
  return [...members]
    .sort((a, b) => (a.role === "OWNER" ? -1 : 0) - (b.role === "OWNER" ? -1 : 0) || a.joinedAt - b.joinedAt)
    .filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.wallet) && !seen.has(m.wallet) && seen.add(m.wallet))
    .slice(0, MAX_MEMBERS);
}

/** The on-chain split: members share half equally, the treasury takes half plus any rounding. */
export function squadShares(members: Member[], treasury: string) {
  const who = payees(members, treasury);
  if (!who.length) throw Error("That squad has no member wallets to pay.");
  const each = Math.floor((10_000 - POT_BPS) / who.length);
  return [
    { address: treasury, shareBps: 10_000 - each * who.length },
    ...who.map((m) => ({ address: m.wallet, shareBps: each })),
  ];
}

export function sameShares(a: { address: string; shareBps: number }[], b: { address: string; shareBps: number }[]) {
  return a.length === b.length && a.every((x) => b.some((y) => y.address === x.address && y.shareBps === x.shareBps));
}

/** The King: the squad with a coin that banked the most SOL this hour, if any banked at all. */
export function pickKing(banked: Record<string, number>, withCoins: Set<string>, struck: Set<string> = new Set()) {
  let best: { groupId: string; gainSol: number } | null = null;
  for (const [id, gainSol] of Object.entries(banked)) {
    if (!withCoins.has(id) || struck.has(id)) continue;
    if (gainSol > 0 && (!best || gainSol > best.gainSol || (gainSol === best.gainSol && id < best.groupId))) best = { groupId: id, gainSol };
  }
  return best;
}

export const WSOL = "So11111111111111111111111111111111111111112";
/** Dollar stablecoins (6 decimals) many traders sell into instead of SOL: USDC, USDT. */
export const STABLES = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);

type TokenBalance = { owner?: string; mint: string; uiTokenAmount: { amount: string } };
/** The parts of an RPC getTransaction (json encoding) that banking reads. */
export type RpcTx = {
  blockTime: number | null;
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[]; loadedAddresses?: { writable: string[]; readonly: string[] } } | null;
  transaction: { message: { accountKeys: (string | { pubkey: string })[] } };
};

/**
 * SOL a wallet banked in one transaction, in lamports: its change in SOL (wrapped SOL included,
 * network fees counted), plus USDC/USDT at `usdPerSol`, when the same transaction moved one of
 * its other tokens the opposite way, so a buy or a sell. Transfers, airdrops and failed
 * transactions are null and don't count.
 */
export function tradeLamports(tx: RpcTx, wallet: string, usdPerSol: number | null = null): bigint | null {
  const meta = tx.meta;
  if (!meta || meta.err) return null;
  const keys = [...tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey)), ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
  const i = keys.indexOf(wallet);
  if (i < 0) return null;
  const amounts = (list: TokenBalance[] | undefined) => {
    const m = new Map<string, bigint>();
    for (const b of list ?? []) if (b.owner === wallet) m.set(b.mint, (m.get(b.mint) ?? 0n) + BigInt(b.uiTokenAmount.amount));
    return m;
  };
  const pre = amounts(meta.preTokenBalances);
  const post = amounts(meta.postTokenBalances);
  let quote = BigInt(meta.postBalances[i] ?? 0) - BigInt(meta.preBalances[i] ?? 0);
  let up = false;
  let down = false;
  for (const mint of new Set([...pre.keys(), ...post.keys()])) {
    const d = (post.get(mint) ?? 0n) - (pre.get(mint) ?? 0n);
    if (mint === WSOL) quote += d;
    // 1 USD unit (1e-6 dollars) is 1000 / usdPerSol lamports.
    else if (STABLES.has(mint)) quote += usdPerSol ? BigInt(Math.round((Number(d) * 1000) / usdPerSol)) : 0n;
    else if (d > 0n) up = true;
    else if (d < 0n) down = true;
  }
  return (down && quote > 0n) || (up && quote < 0n) ? quote : null;
}

/** The treasury's half of every squad coin's fees earned this hour, in lamports. */
export function potLamports(start: Record<string, string>, end: Record<string, string>) {
  let total = 0n;
  for (const [mint, e] of Object.entries(end)) {
    const gained = BigInt(e) - BigInt(start[mint] ?? e);
    if (gained > 0n) total += gained;
  }
  return (total * BigInt(POT_BPS)) / 10_000n;
}

export type Payout = { wallet: string; tokens: string; lamports: string };

/**
 * Splits the holders' share of the pot pro rata to balance among the largest MAX_PAYEES
 * holders. Payouts under the minimum are dropped and their SOL rolls into the next hour.
 */
export function splitPot(holdersLamports: bigint, balances: { wallet: string; amount: bigint }[]) {
  const top = balances.filter((b) => b.amount > 0n).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : a.wallet < b.wallet ? -1 : 1)).slice(0, MAX_PAYEES);
  const supply = top.reduce((n, b) => n + b.amount, 0n);
  const payouts: Payout[] = [];
  let paid = 0n;
  if (supply > 0n && holdersLamports > 0n) {
    for (const b of top) {
      const lamports = (holdersLamports * b.amount) / supply;
      if (lamports < MIN_PAYOUT_LAMPORTS) continue;
      payouts.push({ wallet: b.wallet, tokens: b.amount.toString(), lamports: lamports.toString() });
      paid += lamports;
    }
  }
  return { payouts, paid, rollover: holdersLamports - paid };
}

/**
 * When in an hour the holders are counted: a minute between :05 and :55 picked from a
 * secret, so nobody can buy just before the count and sell right after.
 */
export async function snapshotMinute(hour: number, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`king:${hour}`)));
  return 5 + (mac[0] % 51);
}

/** One hour's result, published for anyone to check and for the treasury workers to pay. */
export type Reign = {
  hour: string;
  /** gainSol: SOL the King's members banked that hour. */
  king: { groupId: string; squad: string; mint: string; gainSol: number } | null;
  potLamports: string;
  holdersLamports: string;
  burnLamports: string;
  carriedInLamports: string;
  rolloverLamports: string;
  snapshotAt: number | null;
  payouts: Payout[];
  status: "pending" | "paid";
  paidSignatures?: string[];
};

/** A coin created during this hour had zero lifetime fees at the hour's start. */
export function seedNewCoinFees(start: Record<string, string>, coins: { mint: string; createdAt: number }[], hour: number) {
  const next = { ...start };
  for (const c of coins) {
    if (c.createdAt >= hour && c.createdAt < hour + HOUR) next[c.mint] = "0";
  }
  return next;
}
