// Called once the launch lands: reads the coin back off chain and, only if the 80/20
// split is locked in, lists it on Pump Tower.
import { body, fail, json } from "@/lib/api";
import { limited } from "@/lib/limit";
import { isAddress, type Draft } from "@/lib/launch/model";
import { verifyLaunch } from "@/lib/launch/pump";
import { getCoin, saveCoin, type Coin, type Profile } from "@/lib/launch/registry";
import { pendingKey } from "@/lib/launch/server";
import { getJson } from "@/lib/redis";
import { after } from "next/server";
import { towerFor } from "@/lib/store";

type Pending = { draft: Draft; recipient: Profile; launcher: string; treasury: string; signature: string | null };

export async function POST(req: Request) {
  const slow = await limited(req, "launch");
  if (slow) return slow;
  try {
    const { mint } = await body<{ mint: string }>(req);
    if (!isAddress(mint)) return json({ error: "bad request" }, 400);
    const done = await getCoin(mint);
    if (done) return json({ coin: done });
    const p = await getJson<Pending>(pendingKey(mint));
    if (!p) return json({ error: "No launch in progress for that coin." }, 404);
    const check = await verifyLaunch(mint, p.recipient.wallet, p.treasury);
    if (!check.ok) return json({ error: check.reason, retry: check.reason === "not on chain yet" }, check.reason === "not on chain yet" ? 202 : 400);
    const { draft } = p;
    const coin: Coin = {
      mint,
      name: draft.name,
      ticker: draft.ticker,
      description: draft.description,
      twitter: draft.twitter,
      telegram: draft.telegram,
      recipient: p.recipient,
      launcher: p.launcher,
      signature: p.signature ?? "",
      createdAt: Date.now(),
    };
    await saveCoin(coin);
    // Build the pump user's tower right away so it stands in the city and skyline before they ever visit.
    after(() => towerFor(p.recipient.wallet, { fresh: true }).catch((e) => console.error("launch tower", e)));
    return json({ coin });
  } catch (e) {
    return fail(e, "launch confirm");
  }
}
