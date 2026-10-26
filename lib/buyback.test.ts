import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { eligibleRevenue, type Distribution } from "./buyback/revenue.ts";
import { buybackInput, verifyBuybackSigned, type BuybackPolicy, type BuybackPlan } from "./buyback/buyback-model.ts";
import { buybackInstructions, verifyBuybackPlan } from "./buyback/buyback-chain.ts";

const keys = Array.from({ length: 6 }, () => Keypair.generate());
const [treasury, mint, creator, fee, buyback, source] = keys.map(k => k.publicKey.toBase58());
const policy: BuybackPolicy = { treasury, mint, maxInput: "10000000", maxOverhead: "9000000", dailyCap: "1000000000", slippageBps: 100, revenueReserve: "20000000" };
const opts = { officialMint: mint, treasury, recipient: creator, registeredMint: source, sharingConfig: fee, nativeMint: buyback, defaultKey: PublicKey.default.toBase58() };
const event: Distribution = { mint: source, sharingConfig: fee, quoteMint: buyback, distributed: "1000000000", shareholders: [{ address: treasury, shareBps: 2000 }, { address: creator, shareBps: 8000 }] };

test("profile revenue credits 20% once, preserves integer dust", () => {
  assert.equal(eligibleRevenue(event, opts), 200000000n);
  assert.equal(eligibleRevenue({ ...event, distributed: "9" }, opts), 1n);
});
test("main coin, unknown mints, wrong vault, quote or split never earn budget", () => {
  for (const change of [{ mint }, { mint: creator }, { sharingConfig: creator }, { quoteMint: creator }, { shareholders: [{ address: treasury, shareBps: 10000 }] }]) {
    assert.equal(eligibleRevenue({ ...event, ...change }, opts), 0n);
  }
  assert.equal(eligibleRevenue(event, { ...opts, officialMint: "" }), 0n);
  assert.equal(eligibleRevenue(event, { ...opts, recipient: treasury }), 0n);
});
test("revenue buys spend the maximum eligible amount while retaining gas and overhead", () => {
  assert.equal(buybackInput(policy, "0", 100000000000n), 0n);
  assert.equal(buybackInput(policy, "10000000", 100000000000n), 1000000n);
  assert.equal(buybackInput(policy, "1000000000", 100000000000n), 991000000n);
  assert.equal(buybackInput(policy, "1000000000", 20000000n), 0n);
  assert.equal(buybackInput(policy, "1000000000", 100000000n), 71000000n);
  assert.equal(buybackInput(policy, "50000000000", 100000000000n), 49991000000n);
  assert.equal(buybackInput({ ...policy, revenueReserve: undefined }, "1000000000", 100000000000n), 10000000n);
  for (const balance of [0n, 20000000n, 30000000n, 100000000n, 100000000000n]) {
    const input = buybackInput(policy, "1000000000", balance);
    if (input > 0n) {
      assert.ok(balance - input - BigInt(policy.maxOverhead) >= BigInt(policy.revenueReserve!));
      assert.ok(input + BigInt(policy.maxOverhead) <= 1000000000n);
    }
  }
  assert.throws(() => buybackInput({ ...policy, slippageBps: 501 }, "100000000", 100000000n));
});
test("a buyback contains the exact buy and burn; altered signed bytes are rejected", async () => {
  const plan: BuybackPlan = { version: 1, policy, unsigned: "", inputCap: "10000000", tokens: "500", decimals: 6, tokenProgram: TOKEN_PROGRAM_ID.toBase58(), creator, feeRecipient: fee, buybackFeeRecipient: buyback, lastValidBlockHeight: 100, contextSlot: 1, preparedAt: Date.now(), fee: "5400" };
  const instructions = await buybackInstructions(plan);
  const burn = instructions[instructions.length - 1];
  assert.equal(burn.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.equal(burn.data[0], 15); // SPL BurnChecked
  assert.equal(burn.data.readBigUInt64LE(1), 500n);
  assert.equal(burn.keys[1].pubkey.toBase58(), mint);
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: keys[0].publicKey, recentBlockhash: keys[5].publicKey.toBase58(), instructions }).compileToV0Message());
  plan.unsigned = Buffer.from(tx.serialize()).toString("base64");
  await verifyBuybackPlan(plan);
  tx.sign([keys[0]]);
  assert.ok(verifyBuybackSigned(plan, Buffer.from(tx.serialize()).toString("base64")));
  await assert.rejects(verifyBuybackPlan({ ...plan, tokens: "501" }));
  tx.message.recentBlockhash = keys[4].publicKey.toBase58();
  assert.throws(() => verifyBuybackSigned(plan, Buffer.from(tx.serialize()).toString("base64")));
});

import { createRequire } from "node:module";
import { validHolderCreator } from "./buyback/holder.ts";
const sdk = createRequire(import.meta.url)("@pump-fun/pump-sdk");
test("holder-reward buys require the official rewards PDA; standard creators remain valid", () => {
  assert.equal(validHolderCreator(keys[1].publicKey, true, sdk.holderRewardsPda(keys[1].publicKey)), true);
  assert.equal(validHolderCreator(keys[1].publicKey, true, keys[2].publicKey), false);
  assert.equal(validHolderCreator(keys[1].publicKey, false, keys[2].publicKey), true);
});

import { TREASURY_WALLET, DEV_WALLET } from "./game.ts";
test("configured vanity wallets are valid, separate, and start with king", () => {
  assert.notEqual(TREASURY_WALLET, DEV_WALLET);
  for (const address of [TREASURY_WALLET, DEV_WALLET]) {
    assert.ok(address && /^king/i.test(address));
    assert.equal(new PublicKey(address).toBase58(), address);
    assert.ok(PublicKey.isOnCurve(new PublicKey(address).toBytes()));
  }
});
