import { VersionedTransaction, type Connection } from "@solana/web3.js";
import type { Attempt } from "./journal.ts";
import type { BuybackAttempt } from "../buyback/buyback-model.ts";
/** Unknown/expired submissions never become eligible for a replacement payment. */
export async function reconcileAttempt(
  j: { save(): Promise<void>; fence(): Promise<void> },
  a: Attempt,
  c: Connection,
  verifyBurn: (a: BuybackAttempt) => Promise<void>,
) {
  if (a.status === "finalized") {
    if (a.failed) throw Error("transaction_failed");
    return true;
  }
  const receipt = await c.getTransaction(a.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (receipt) {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(a.signed, "base64"),
    );
    if (
      !receipt.meta ||
      !Buffer.from(receipt.transaction.message.serialize()).equals(
        Buffer.from(tx.message.serialize()),
      )
    )
      throw Error("receipt_mismatch");
    if (a.burn && !receipt.meta.err) await verifyBurn(a.burn);
    a.status = "finalized";
    a.failed = !!receipt.meta.err;
    await j.save();
    if (a.failed) throw Error("transaction_failed");
    return true;
  }
  if ((await c.getBlockHeight("finalized")) > a.expires)
    throw Error("expired_unresolved");
  await j.fence();
  const sig = await c.sendRawTransaction(Buffer.from(a.signed, "base64"), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  if (sig !== a.signature) throw Error("broadcast_signature_mismatch");
  return false;
}
