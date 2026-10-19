// Server-only: where every creator fee has gone, for the fees-routed tracker on /tokens.
// Reads the coin registry and the buyback and $PTWR fee-collection ledgers; never writes
// or takes their locks, so it can't disturb a worker mid-run.
import { getJson, hasDb } from "../redis";
import { HOUSE_MINT } from "../game";
import { SPLIT } from "./model";
import { coinView } from "./fees";
import { latestCoins } from "./registry";

const LAMPORTS = 1e9;
/** pump.fun coins, $PTWR included, have six decimals. */
const PTWR_DECIMALS = 6;

type BuybackLedger = {
  mint: string;
  credit: string;
  debit: string;
  burned: string;
  updatedAt: number;
  lastBuyback?: { signature: string; debit: string; burned: string; success: boolean };
};
type DevFeeLedger = { totalNetLamports: string; updatedAt: number; lastReceipt?: { signature: string; success: boolean; netLamports: string } };

export type FeesRouted = {
  coins: number;
  /** Lifetime creator fees across every coin launched here, in SOL. */
  creatorSol: number;
  toUsersSol: number;
  toTreasurySol: number;
  /** Treasury SOL the buyback worker has verified and may spend, and what it has spent. */
  buybackEligibleSol: number;
  buybackSpentSol: number;
  burnedPtwr: number;
  lastBuyback: { signature: string; sol: number; burned: number } | null;
  /** $PTWR's own creator fees collected into the dev wallet. */
  houseFeesSol: number;
  lastHouseCollect: string | null;
  houseMint: string | null;
  updatedAt: number | null;
};

const num = (s: string | undefined, scale: number) => (s ? Number(BigInt(s)) / scale : 0);

export async function feesRouted(): Promise<FeesRouted> {
  const coins = await latestCoins(0, 500);
  const views = await Promise.all(coins.map((c) => coinView(c)));
  const creatorSol = views.reduce((n, v) => n + v.feesSol, 0);
  const [buyback, dev] = hasDb()
    ? await Promise.all([getJson<BuybackLedger>("pt:buyback:v1").catch(() => null), getJson<DevFeeLedger>("pt:dev-fees:v1").catch(() => null)])
    : [null, null];
  const last = buyback?.lastBuyback?.success ? buyback.lastBuyback : null;
  return {
    coins: coins.length,
    creatorSol,
    toUsersSol: (creatorSol * SPLIT.recipientBps) / 10_000,
    toTreasurySol: (creatorSol * SPLIT.treasuryBps) / 10_000,
    buybackEligibleSol: num(buyback?.credit, LAMPORTS),
    buybackSpentSol: num(buyback?.debit, LAMPORTS),
    burnedPtwr: num(buyback?.burned, 10 ** PTWR_DECIMALS),
    lastBuyback: last ? { signature: last.signature, sol: num(last.debit, LAMPORTS), burned: num(last.burned, 10 ** PTWR_DECIMALS) } : null,
    houseFeesSol: num(dev?.totalNetLamports, LAMPORTS),
    lastHouseCollect: dev?.lastReceipt?.success ? dev.lastReceipt.signature : null,
    houseMint: buyback?.mint ?? HOUSE_MINT,
    updatedAt: Math.max(buyback?.updatedAt ?? 0, dev?.updatedAt ?? 0) || null,
  };
}
