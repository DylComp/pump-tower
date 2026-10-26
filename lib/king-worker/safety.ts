import { createHash } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { rawLamports } from "../buyback/amount.ts";
import type { Reign } from "../king/model.ts";
export const RESERVE = 50_000_000n;
export const LAUNCH_MIN = 100_000_000;
export const END = Date.parse("2026-11-09T14:00:00Z");
export const TREASURY = "kiNGXkmkJSMPQoFEdUZs68nANK16C1AjyQD2jVPY46C";
export const DEV = "KiNgDiSzoX9Z69LoRZh73QkBhJNLqxDbJKgQ2bHmon7";
export const MINT = "5ChT61vPfByx2NApxSNT4iPMTRCV39m5z88bXYcppump";
export function checkedReign(r: Reign) {
  if (!/^2026-\d{2}-\d{2}T\d{2}Z$/.test(r.hour)) throw Error("invalid_hour");
  const ms = Date.parse(r.hour.replace("Z", ":00:00Z"));
  if (
    !Number.isFinite(ms) ||
    ms >= END ||
    ms < Date.parse("2026-10-26T00:00:00Z")
  )
    throw Error("hour_outside_cup");
  if (!Array.isArray(r.payouts) || r.payouts.length > 200)
    throw Error("invalid_payouts");
  const wallets = new Set<string>();
  let total = 0n;
  for (const p of r.payouts) {
    if (
      new PublicKey(p.wallet).toBase58() !== p.wallet ||
      wallets.has(p.wallet) ||
      p.wallet === TREASURY
    )
      throw Error("invalid_payee");
    wallets.add(p.wallet);
    const n = rawLamports(p.lamports);
    if (n === 0n) throw Error("zero_payout");
    total += n;
  }
  if (total > rawLamports(r.holdersLamports))
    throw Error("payouts_exceed_allocation");
  const burn = rawLamports(r.burnLamports),
    rollover = rawLamports(r.rolloverLamports);
  if (total + burn + rollover > rawLamports(r.potLamports))
    throw Error("allocations_exceed_pot");
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        hour: r.hour,
        payouts: r.payouts,
        holders: r.holdersLamports,
        burn: r.burnLamports,
        rollover: r.rolloverLamports,
        pot: r.potLamports,
      }),
    )
    .digest("hex");
  return { total, burn, rollover, digest };
}
export function assertBudget(
  balance: bigint,
  spend: bigint,
  fees: bigint,
  rollover = 0n,
) {
  if (balance < RESERVE + rollover + spend + fees)
    throw Error("treasury_reserve_or_rollover");
}
export function checkLaunch(
  tx: VersionedTransaction,
  launcher: PublicKey,
  mint?: PublicKey,
) {
  const keys = tx.message.staticAccountKeys;
  if (
    !keys[0].equals(launcher) ||
    tx.message.header.numRequiredSignatures !== (mint ? 2 : 1)
  )
    throw Error("launch_signer_mismatch");
  if (mint && !keys.slice(0, 2).some((k) => k.equals(mint)))
    throw Error("launch_mint_mismatch");
  if (tx.signatures.some((s) => s.some((v) => v !== 0)))
    throw Error("unexpected_signature");
}
