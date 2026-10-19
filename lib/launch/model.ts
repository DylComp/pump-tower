// Launchpad rules shared by the launch page and the server: what a coin draft may
// contain, and the fixed 80/20 creator-fee split. No chain or node code here.
import { SITE_URL } from "../site.ts";

export const SPLIT = { recipientBps: 8000, treasuryBps: 2000 } as const;
export const MAX_IMAGE_BYTES = 400_000;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export type Draft = {
  name: string;
  ticker: string;
  description: string;
  twitter: string;
  telegram: string;
  /** SOL to buy in the same transaction, as typed. Empty means none. */
  initialBuy: string;
};

export const emptyDraft: Draft = { name: "", ticker: "", description: "", twitter: "", telegram: "", initialBuy: "" };

export const isAddress = (s: unknown): s is string => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** Every coin's website is its page here, so traders always land back on Pump Tower. */
export const tokenPage = (mint: string) => `${SITE_URL}/t/${mint}`;

const bytes = (s: string) => new TextEncoder().encode(s).length;

export function initialBuyLamports(value: string): bigint {
  if (value === "") return 0n;
  if (!/^(0|[1-9]\d{0,2})(\.\d{1,9})?$/.test(value)) throw Error("Use a SOL amount with up to nine decimals.");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (amount > 10_000_000_000n || (amount > 0n && amount < 1_000_000n)) throw Error("Dev buy must be 0, or between 0.001 and 10 SOL.");
  return amount;
}

/** Cleans and checks a draft. Throws a message fit to show the launcher. */
export function cleanDraft(value: unknown): Draft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Fill in the coin.");
  const v = value as Record<string, unknown>;
  const str = (k: keyof Draft) => (typeof v[k] === "string" ? (v[k] as string) : "");
  const d: Draft = {
    name: str("name").trim(),
    ticker: str("ticker").trim().replace(/^\$/, "").toUpperCase(),
    description: str("description").trim(),
    twitter: str("twitter").trim(),
    telegram: str("telegram").trim(),
    initialBuy: str("initialBuy").trim(),
  };
  if (!d.name || bytes(d.name) > 32 || /[\u0000-\u001f\u007f]/.test(d.name)) throw Error("Name needs 1 to 32 characters.");
  if (!/^[A-Z0-9]{1,10}$/.test(d.ticker)) throw Error("Ticker needs 1 to 10 letters or numbers.");
  if (d.description.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(d.description)) throw Error("Description must be 1,000 characters or fewer.");
  for (const key of ["twitter", "telegram"] as const) {
    if (!d[key]) continue;
    let url: URL;
    try {
      url = new URL(d[key]);
    } catch {
      throw Error(`The ${key === "twitter" ? "X" : "Telegram"} link must be a full https link.`);
    }
    if (d[key].length > 200 || url.protocol !== "https:" || url.username || url.password || url.port) throw Error("Links must be plain https links.");
    if (key === "twitter" && !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) throw Error("Use an x.com link for X.");
    if (key === "telegram" && url.hostname !== "t.me") throw Error("Use a t.me link for Telegram.");
  }
  initialBuyLamports(d.initialBuy);
  return d;
}

export function shares(recipient: string, treasury: string) {
  if (!isAddress(recipient) || !isAddress(treasury) || recipient === treasury) throw Error("Fees need two different wallets.");
  return [
    { address: recipient, shareBps: SPLIT.recipientBps },
    { address: treasury, shareBps: SPLIT.treasuryBps },
  ];
}

/** The token metadata pump.fun and wallets read, hosted on our domain. */
export function metadataJson(d: Draft, mint: string, imageUrl: string) {
  return {
    name: d.name,
    symbol: d.ticker,
    description: d.description,
    image: imageUrl,
    showName: true,
    createdOn: SITE_URL,
    website: tokenPage(mint),
    ...(d.twitter ? { twitter: d.twitter } : {}),
    ...(d.telegram ? { telegram: d.telegram } : {}),
  };
}

/** Lifetime creator-fee milestones, in SOL, that level up a coin's tower floor. */
export const FEE_TIERS = [0, 0.1, 1, 5, 25, 100] as const;
/** What each milestone turns the coin's floor in the recipient's tower into. */
export const FEE_TIER_NAMES = ["ground floor", "neon sign", "sky lounge", "rooftop club", "gold spire", "the crown"] as const;
export const feeTier = (sol: number) => FEE_TIERS.reduce<number>((t, min, i) => (sol >= min ? i : t), 0);

type ProfileCoin = {
  mint: string;
  name: string;
  ticker: string;
  createdAt: number;
  feesSol: number;
  recipientSol: number;
  mcapUsd?: number | null;
  recipient: { wallet: string; username: string | null; image: string | null; x: string | null; followers: number | null };
};

export type ProfileStats<P = ProfileCoin["recipient"]> = {
  profile: P;
  coins: number;
  feesSol: number;
  recipientSol: number;
  mcapUsd: number;
  top: { mint: string; name: string; ticker: string; mcapUsd: number | null } | null;
  latest: number;
};

/** Every pump user coins were launched for, with their totals, most fees first, then most market cap. */
export function profileStats<C extends ProfileCoin>(coins: C[]): ProfileStats<C["recipient"]>[] {
  const by = new Map<string, ProfileStats<C["recipient"]>>();
  for (const c of coins) {
    const p = by.get(c.recipient.wallet) ?? { profile: c.recipient, coins: 0, feesSol: 0, recipientSol: 0, mcapUsd: 0, top: null, latest: 0 };
    p.coins++;
    p.feesSol += c.feesSol;
    p.recipientSol += c.recipientSol;
    p.mcapUsd += c.mcapUsd ?? 0;
    if (!p.top || (c.mcapUsd ?? -1) > (p.top.mcapUsd ?? -1)) p.top = { mint: c.mint, name: c.name, ticker: c.ticker, mcapUsd: c.mcapUsd ?? null };
    // The newest coin carries the freshest copy of the profile.
    if (c.createdAt > p.latest) {
      p.latest = c.createdAt;
      p.profile = c.recipient;
    }
    by.set(c.recipient.wallet, p);
  }
  return [...by.values()].sort((a, b) => b.feesSol - a.feesSol || b.mcapUsd - a.mcapUsd || b.latest - a.latest);
}
