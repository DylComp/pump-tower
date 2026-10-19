import { fail, json } from "@/lib/api";
import { limited } from "@/lib/limit";
import { marketCaps } from "@/lib/chain";
import { coinView } from "@/lib/launch/fees";
import { isAddress, profileStats } from "@/lib/launch/model";
import { coinCount, coinsFor, latestCoins, type Coin } from "@/lib/launch/registry";

async function withCaps(coins: Coin[]) {
  const [views, caps] = await Promise.all([Promise.all(coins.map((c) => coinView(c))), marketCaps(coins.map((c) => c.mint))]);
  return views.map((v) => ({ ...v, mcapUsd: caps.get(v.mint) ?? null }));
}

/**
 * Coins launched here, newest first, each with its market cap; every coin launched for one
 * wallet (?for=); or every pump user coins were launched for, with their totals (?view=profiles).
 */
export async function GET(req: Request) {
  const slow = await limited(req, "tokens");
  if (slow) return slow;
  const url = new URL(req.url);
  const forWallet = url.searchParams.get("for");
  const page = Math.max(0, Math.min(50, Number(url.searchParams.get("page")) || 0));
  try {
    if (forWallet && !isAddress(forWallet)) return json({ error: "not a solana address" }, 400);
    if (url.searchParams.get("view") === "profiles") {
      const views = await withCaps(await latestCoins(0, 300));
      return json({ profiles: profileStats(views), total: views.length });
    }
    const coins = forWallet ? await coinsFor(forWallet) : await latestCoins(page * 30, 30);
    const [views, total] = await Promise.all([withCaps(coins), coinCount()]);
    return json({ coins: views, total });
  } catch (e) {
    return fail(e, "tokens");
  }
}
