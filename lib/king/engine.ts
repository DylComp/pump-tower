// Server-only: the King of the Hill clock, run every five minutes by a cron. It's also the
// worker that watches the squads:
//  - every run, scans the wallets of every squad with a coin for new trades (scan.ts) and adds
//    the SOL they banked to their squad's hour;
//  - at the top of each hour, reads every squad coin's lifetime creator fees (the pot);
//  - at a secret minute inside the hour, counts the holders of every squad coin;
//  - once every wallet has been scanned past the hour's end, crowns the squad that banked the
//    most SOL and writes the payout list. The treasury workers send the SOL; nothing here signs.
import { getJson, setJson, redis } from "../redis";
import { lifetimeLamports, holderBalances } from "./chain";
import { COMPETITION_ENDS, HOLDERS_BPS, HOUR, hourId, hourOf, pickKing, potLamports, snapshotMinute, splitPot, seedNewCoinFees, type Reign } from "./model";
import { allScannedSince, scanWallets } from "./scan";
import { struckSquads, walletsOf } from "./source";
import { allSquadCoins, bankedAt, carried, feesAt, hasHolders, holdersAt, reign, saveFees, saveHolders, saveReign, setCarried } from "./store";

const NOW = "pt:king:now";
/** If some wallets still aren't scanned this long after an hour ends, crown it with what's in. */
const SCAN_GRACE = 25 * 60_000;
/** Time each run spends scanning wallets, inside the cron's 60 seconds. */
const SCAN_BUDGET = 35_000;

const secret = () => process.env.KING_SECRET || process.env.CRON_SECRET || "";

export async function runKing(now = Date.now()) {
  // Never crown post-cup hours. A delayed final crown may catch up after the deadline.
  if (now >= COMPETITION_ENDS && await reign(hourId(COMPETITION_ENDS - HOUR))) return { done: "competition over" };
  const hour = Math.min(hourOf(now), COMPETITION_ENDS);
  const coins = await allSquadCoins();
  const wallets = walletsOf(new Set(coins.map((c) => c.groupId)));
  const log: string[] = [];

  // Top-of-hour fee readings first: they bound the pot exactly.
  if (!(await feesAt(hour))) {
    const fees: Record<string, string> = {};
    const read = await lifetimes(coins.map((c) => c.mint));
    for (const c of coins) fees[c.mint] = read[c.mint] ?? (await previousFee(hour, c.mint));
    await saveFees(hour, fees);
    log.push(`fees ${hourId(hour)}`);
  }

  // Coins launched after the boundary must not lose their entire first hour of fees.
  const baseline = await feesAt(hour);
  if (baseline) {
    const seeded = seedNewCoinFees(baseline, coins, hour);
    if (JSON.stringify(seeded) !== JSON.stringify(baseline)) {
      await saveFees(hour, seeded);
      await redis("DEL", NOW);
    }
  }

  // Holder count at the hour's secret minute.
  if (secret() && now >= hour + (await snapshotMinute(hour, secret())) * 60_000) {
    let counted = 0;
    for (const c of coins) {
      if (counted >= 25 || (await hasHolders(hour, c.mint))) continue;
      await saveHolders(hour, c.mint, await holderBalances(c.mint, c.launcher));
      counted++;
    }
    if (counted) log.push(`holders ${counted}`);
  }

  // Watch the squads' wallets, with whatever time the run has left.
  const scan = await scanWallets(wallets, now + SCAN_BUDGET);
  log.push(`scanned ${scan.scanned}/${wallets.length} wallets, ${scan.txs} txs${scan.failed ? `, ${scan.failed} failed` : ""}`);

  // Crown last hour.
  const prev = hour - HOUR;
  if (!(await reign(hourId(prev)))) {
    const [feesStart, feesEnd] = await Promise.all([feesAt(prev), feesAt(hour)]);
    // Wait until every wallet has been scanned past the hour's end (or the grace runs out).
    if (feesStart && feesEnd && ((await allScannedSince(wallets, hour + 60_000)) || now - hour > SCAN_GRACE)) {
      const banked = Object.fromEntries(Object.entries(await bankedAt(prev)).map(([id, l]) => [id, Number(BigInt(l)) / 1e9]));
      const winner = pickKing(banked, new Set(coins.map((c) => c.groupId)), struckSquads());
      const coin = winner && coins.find((c) => c.groupId === winner.groupId)!;
      const carriedIn = await carried();
      const pot = potLamports(feesStart, feesEnd) + carriedIn;
      let r: Reign;
      if (!coin) {
        r = { hour: hourId(prev), king: null, potLamports: pot.toString(), holdersLamports: "0", burnLamports: "0", carriedInLamports: carriedIn.toString(), rolloverLamports: pot.toString(), snapshotAt: null, payouts: [], status: "paid" };
      } else {
        let balances = await holdersAt(prev, coin.mint);
        let snapshotAt = prev + (await snapshotMinute(prev, secret())) * 60_000;
        if (!balances) {
          // The count was missed (outage): count now rather than skip the hour.
          balances = await holderBalances(coin.mint, coin.launcher);
          snapshotAt = now;
        }
        const holders = (pot * BigInt(HOLDERS_BPS)) / 10_000n;
        const split = splitPot(holders, Object.entries(balances).map(([wallet, a]) => ({ wallet, amount: BigInt(a) })));
        r = {
          hour: hourId(prev),
          king: { groupId: coin.groupId, squad: coin.squad, mint: coin.mint, gainSol: winner!.gainSol },
          potLamports: pot.toString(),
          holdersLamports: split.paid.toString(),
          burnLamports: (pot - holders).toString(),
          carriedInLamports: carriedIn.toString(),
          rolloverLamports: split.rollover.toString(),
          snapshotAt,
          payouts: split.payouts,
          status: split.payouts.length || pot > holders ? "pending" : "paid",
        };
      }
      await saveReign(r);
      await setCarried(BigInt(r.rolloverLamports));
      log.push(`king ${r.hour}: ${r.king?.squad ?? "none"}`);
    }
  }
  await potSoFar(now).catch(() => null);
  return { hour: hourId(hour), coins: coins.length, log };
}

/** Lifetime fees for many coins, ten at a time; a failed read is left out. */
async function lifetimes(mints: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < mints.length; i += 10) {
    await Promise.all(mints.slice(i, i + 10).map(async (m) => {
      const v = await lifetimeLamports(m).catch(() => null);
      if (v != null) out[m] = v.toString();
    }));
  }
  return out;
}

/** The pot building up this hour so far (plus carry), for the live page. Cached a few minutes. */
export async function potSoFar(now = Date.now()) {
  const cached = await getJson<{ hour: number; lamports: string; at: number }>(NOW);
  if (cached && cached.hour === hourOf(now) && now - cached.at < 4 * 60_000) return BigInt(cached.lamports);
  const start = await feesAt(hourOf(now));
  if (!start) return carried();
  const lamports = potLamports(start, await lifetimes(Object.keys(start))) + (await carried());
  await setJson(NOW, { hour: hourOf(now), lamports: lamports.toString(), at: now }, 600);
  return lamports;
}

/** What the page shows: the last pot reading for this hour, never a fresh chain read. */
export async function cachedPot(now = Date.now()) {
  const cached = await getJson<{ hour: number; lamports: string }>(NOW);
  return cached && cached.hour === hourOf(now) ? BigInt(cached.lamports) : await carried();
}

/** If a fee read fails, carry the last known total so the hour's pot isn't inflated later. */
async function previousFee(hour: number, mint: string) {
  for (let h = hour - HOUR; h > hour - 24 * HOUR; h -= HOUR) {
    const f = await feesAt(h);
    if (f?.[mint]) return f[mint];
  }
  return "0";
}
