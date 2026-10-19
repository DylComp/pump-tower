import { fail, json } from "@/lib/api";
import { limited } from "@/lib/limit";
import { coinView } from "@/lib/launch/fees";
import { marketCaps } from "@/lib/launch/market";
import { isAddress } from "@/lib/launch/model";
import { coinCount, coinsFor, latestCoins, type CoinView, type ProfileSummary } from "@/lib/launch/registry";

async function withCaps(views: CoinView[]): Promise<CoinView[]> {
  const caps = await marketCaps(views.map((v) => v.mint)).catch(() => ({}) as Record<string, number | null>);
  return views.map((v) => ({ ...v, mcapUsd: caps[v.mint] ?? null }));
}

/** Every pump user coins were launched for, with their totals, most fees first. */
function profiles(views: CoinView[]): ProfileSummary[] {
  const by = new Map<string, ProfileSummary>();
  for (const v of views) {
    const cap = v.mcapUsd ?? null;
    const p = by.get(v.recipient.wallet);
    if (!p) {
      by.set(v.recipient.wallet, { profile: v.recipient, coins: 1, feesSol: v.feesSol, earnedSol: v.recipientSol, mcapUsd: cap ?? 0, top: { mint: v.mint, ticker: v.ticker, mcapUsd: cap }, recent: [{ mint: v.mint, ticker: v.ticker }], latest: v.createdAt });
      continue;
    }
    p.coins++;
    p.feesSol += v.feesSol;
    p.earnedSol += v.recipientSol;
    p.mcapUsd += cap ?? 0;
    // Coins arrive newest first, so the strip keeps the latest five.
    if (p.recent.length < 5) p.recent.push({ mint: v.mint, ticker: v.ticker });
    if ((cap ?? -1) > (p.top.mcapUsd ?? -1)) p.top = { mint: v.mint, ticker: v.ticker, mcapUsd: cap };
    if (v.createdAt > p.latest) {
      p.latest = v.createdAt;
      p.profile = v.recipient;
    }
  }
  return [...by.values()].sort((a, b) => b.feesSol - a.feesSol || b.mcapUsd - a.mcapUsd);
}

/** Coins launched here, newest first; every coin launched for one wallet (?for=); or pump profiles (?view=profiles). */
export async function GET(req: Request) {
  const slow = await limited(req, "tokens");
  if (slow) return slow;
  const url = new URL(req.url);
  const forWallet = url.searchParams.get("for");
  const page = Math.max(0, Math.min(50, Number(url.searchParams.get("page")) || 0));
  try {
    if (url.searchParams.get("view") === "profiles") {
      const all = await latestCoins(0, 500);
      const views = await withCaps(await Promise.all(all.map((c) => coinView(c))));
      return json({ profiles: profiles(views), coins: all.length });
    }
    if (forWallet && !isAddress(forWallet)) return json({ error: "not a solana address" }, 400);
    const coins = forWallet ? await coinsFor(forWallet) : await latestCoins(page * 30, 30);
    const [views, total] = await Promise.all([Promise.all(coins.map((c) => coinView(c))).then(withCaps), coinCount()]);
    return json({ coins: views, total });
  } catch (e) {
    return fail(e, "tokens");
  }
}
