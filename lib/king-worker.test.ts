import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  assertBudget,
  checkedReign,
  checkLaunch,
  RESERVE,
} from "./king-worker/safety.ts";
import type { Reign } from "./king/model.ts";
const wallet = Keypair.generate().publicKey.toBase58();
const fixture = (): Reign => ({
  hour: "2026-10-26T13Z",
  king: null,
  potLamports: "10000000",
  holdersLamports: "8000000",
  burnLamports: "2000000",
  carriedInLamports: "0",
  rolloverLamports: "0",
  snapshotAt: null,
  payouts: [{ wallet, tokens: "100", lamports: "8000000" }],
  status: "pending",
});
test("valid integer allocation; payment status does not change commitment", () => {
  const r = fixture();
  const a = checkedReign(r);
  assert.equal(a.total, 8000000n);
  r.status = "paid";
  assert.equal(a.digest, checkedReign(r).digest);
  r.payouts[0].lamports = "7000000";
  assert.notEqual(a.digest, checkedReign(r).digest);
});
test("reject duplicate wallets and over-allocation before any transfer", () => {
  const r = fixture();
  r.payouts.push({ ...r.payouts[0] });
  assert.throws(() => checkedReign(r), /invalid_payee/);
  r.payouts.pop();
  r.payouts[0].lamports = "8000001";
  assert.throws(() => checkedReign(r), /exceed/);
});
test("reject floats, negative and invalid addresses", () => {
  for (const n of ["-1", "1.1", "1e9", "900000000000000000000"]) {
    const r = fixture();
    r.payouts[0].lamports = n;
    assert.throws(() => checkedReign(r));
  }
  const r = fixture();
  r.payouts[0].wallet = "invalid";
  assert.throws(() => checkedReign(r));
});
test("reserve, network fees and rollover remain untouched", () => {
  assertBudget(RESERVE + 100n, 80n, 10n, 10n);
  assert.throws(() => assertBudget(RESERVE + 99n, 80n, 10n, 10n));
});
test("cup excludes end hour and later", () => {
  const r = fixture();
  r.hour = "2026-11-09T14Z";
  assert.throws(() => checkedReign(r));
  r.hour = "2026-11-09T13Z";
  assert.doesNotThrow(() => checkedReign(r));
});
test("launch signer checks reject substituted mint or payer and extra signatures", () => {
  const payer = Keypair.generate(),
    mint = Keypair.generate();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: 1,
          space: 0,
          programId: SystemProgram.programId,
        }),
      ],
    }).compileToV0Message(),
  );
  checkLaunch(tx, payer.publicKey, mint.publicKey);
  assert.throws(() =>
    checkLaunch(tx, Keypair.generate().publicKey, mint.publicKey),
  );
  assert.throws(() =>
    checkLaunch(tx, payer.publicKey, Keypair.generate().publicKey),
  );
  tx.sign([payer, mint]);
  assert.throws(() => checkLaunch(tx, payer.publicKey, mint.publicKey));
});

import {
  validateBuybackPolicy,
  buybackInput,
} from "./buyback/buyback-model.ts";
import { MINT, TREASURY } from "./king-worker/safety.ts";
test("King dust burns are bounded to their hour; old buyback minimum stays unchanged", () => {
  const p = {
    purpose: "king-hour" as const,
    treasury: TREASURY,
    mint: MINT,
    maxInput: "100",
    maxOverhead: "10000000",
    dailyCap: "10000100",
    slippageBps: 100,
  };
  validateBuybackPolicy(p);
  assert.equal(buybackInput(p, "10000100", 90000000n), 100n);
  assert.throws(() => validateBuybackPolicy({ ...p, purpose: undefined }));
});

import { reconcileAttempt } from "./king-worker/reconcile.ts";
import type { Attempt } from "./king-worker/journal.ts";
import type { Connection } from "@solana/web3.js";
import bs58 from "bs58";
function transferAttempt() {
  const payer = Keypair.generate(),
    to = Keypair.generate();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: to.publicKey,
          lamports: 100,
        }),
      ],
    }).compileToV0Message(),
  );
  tx.sign([payer]);
  const a: Attempt = {
    signed: Buffer.from(tx.serialize()).toString("base64"),
    signature: bs58.encode(tx.signatures[0]),
    expires: 100,
    status: "pending",
    wallets: [to.publicKey.toBase58()],
  };
  return { a, tx };
}
test("pending payments resend identical persisted bytes after a timeout", async () => {
  const { a } = transferAttempt();
  const sent: Buffer[] = [];
  let fenced = 0;
  const c = {
    getTransaction: async () => null,
    getBlockHeight: async () => 90,
    sendRawTransaction: async (bytes: Buffer) => {
      sent.push(bytes);
      return a.signature;
    },
  } as unknown as Connection;
  const j = {
    save: async () => {},
    fence: async () => {
      fenced++;
    },
  };
  assert.equal(await reconcileAttempt(j, a, c, async () => {}), false);
  assert.equal(await reconcileAttempt(j, a, c, async () => {}), false);
  assert.equal(fenced, 2);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(a.status, "pending");
});
test("finalized receipts settle once; expired unknown receipts never resend", async () => {
  const { a, tx } = transferAttempt();
  let saved = 0;
  const j = {
    save: async () => {
      saved++;
    },
    fence: async () => {
      throw Error("unexpected_send");
    },
  };
  const c = {
    getTransaction: async () => ({
      meta: { err: null },
      transaction: { message: tx.message },
    }),
  } as unknown as Connection;
  assert.equal(await reconcileAttempt(j, a, c, async () => {}), true);
  assert.equal(await reconcileAttempt(j, a, c, async () => {}), true);
  assert.equal(saved, 1);
  const other = transferAttempt().a;
  await assert.rejects(
    () =>
      reconcileAttempt(
        j,
        other,
        {
          getTransaction: async () => null,
          getBlockHeight: async () => 101,
        } as unknown as Connection,
        async () => {},
      ),
    /expired_unresolved/,
  );
  assert.equal(other.status, "pending");
});
test("failed receipts are recorded; mismatched receipts and lost leases cannot settle or send", async () => {
  const { a, tx } = transferAttempt();
  let saved = 0;
  const j = {
    save: async () => {
      saved++;
    },
    fence: async () => {
      throw Error("lease_lost");
    },
  };
  await assert.rejects(
    () =>
      reconcileAttempt(
        j,
        a,
        {
          getTransaction: async () => ({
            meta: { err: { InstructionError: [0, "x"] } },
            transaction: { message: tx.message },
          }),
        } as unknown as Connection,
        async () => {},
      ),
    /transaction_failed/,
  );
  assert.equal(a.failed, true);
  assert.equal(saved, 1);
  const other = transferAttempt().a;
  await assert.rejects(
    () =>
      reconcileAttempt(
        j,
        other,
        {
          getTransaction: async () => ({
            meta: { err: null },
            transaction: { message: tx.message },
          }),
        } as unknown as Connection,
        async () => {},
      ),
    /receipt_mismatch/,
  );
  await assert.rejects(
    () =>
      reconcileAttempt(
        j,
        other,
        {
          getTransaction: async () => null,
          getBlockHeight: async () => 90,
        } as unknown as Connection,
        async () => {},
      ),
    /lease_lost/,
  );
});

import { openJournal } from "./king-worker/journal.ts";
test("journal serializes invocations, survives restart and fences an expired owner", async () => {
  const db = new Map<string, string>();
  const command = async <T = unknown>(
    ...args: (string | number)[]
  ): Promise<T> => {
    const [cmd, ...a] = args;
    let result: unknown;
    if (cmd === "GET") result = db.get(String(a[0])) ?? null;
    else if (cmd === "SET") {
      if (a.includes("NX") && db.has(String(a[0]))) result = null;
      else {
        db.set(String(a[0]), String(a[1]));
        result = "OK";
      }
    } else if (cmd === "EVAL") {
      const count = Number(a[1]),
        keys = a.slice(2, 2 + count).map(String),
        v = a.slice(2 + count).map(String);
      if (count === 2) {
        if (db.get(keys[0]) !== v[0] || (db.get(keys[1]) ?? "") !== v[1])
          result = 0;
        else {
          db.set(keys[1], v[2]);
          result = 1;
        }
      } else {
        if (db.get(keys[0]) === v[0]) {
          db.delete(keys[0]);
          result = 1;
        } else result = 0;
      }
    } else throw Error("unsupported_mock_command");
    return result as T;
  };
  const first = await openJournal(command);
  assert.ok(first);
  assert.equal(await openJournal(command), null);
  first.state.testPassed = true;
  await first.save();
  await first.fence();
  await first.close();
  const second = await openJournal(command);
  assert.ok(second);
  assert.equal(second.state.testPassed, true);
  db.delete("pt:king:worker:v1:lock");
  const third = await openJournal(command);
  assert.ok(third);
  await assert.rejects(() => second.fence(), /lease/);
  await assert.rejects(() => second.save(), /lease/);
  await second.close();
  assert.equal(await openJournal(command), null);
  await third.close();
});
