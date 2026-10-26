// Server-only: builds and checks Pump Tower launches with pump.fun's official SDK.
// The launcher's wallet and a fresh mint key are the only signers. We never hold a key:
// the server builds an unsigned transaction, the browser signs it, the server reads
// the result back off chain. Same shape as fub's 80/20 launches, SOL pairs only.
import { createRequire } from "node:module";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
  type AccountInfo,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { BondingCurve, SharingConfig } from "@pump-fun/pump-sdk";
import { rpcUrl } from "../chain";
import { buildTable, loadLookupTable, tableAddresses } from "./alt";
import { type Draft, initialBuyLamports, shares } from "./model";
import { matchesPrepared, tablesFor } from "./verify";

// CommonJS avoids the SDK's Anchor ESM named-export problem on Node.
const require = createRequire(import.meta.url);
const sdk = require("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
const BN = require("bn.js") as typeof import("bn.js");
const { PUMP_SDK, OnlinePumpSdk, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, feeSharingConfigPda, bondingCurvePda, creatorVaultPda } = sdk;

export const connection = () => new Connection(rpcUrl(), "confirmed");

/**
 * A priority fee (micro-lamports per compute unit) that actually lands on a busy network: the
 * 75th percentile of recent fees paid around pump.fun, kept between 100k and 2M. At the 600k
 * unit limit that is 0.00006 to 0.0012 SOL.
 */
export async function priorityFee(conn: Connection): Promise<number> {
  try {
    const recent = await conn.getRecentPrioritizationFees({ lockedWritableAccounts: [PUMP_PROGRAM_ID, GLOBAL_PDA] });
    const fees = recent.map((r) => r.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b);
    const p75 = fees.length ? fees[Math.floor(fees.length * 0.75)] : 0;
    return Math.min(2_000_000, Math.max(100_000, p75));
  } catch {
    return 200_000;
  }
}

function key(value: string, what: string) {
  const k = new PublicKey(value);
  if (k.toBase58() !== value) throw Error(`Bad ${what} address.`);
  return k;
}

/** `setup` is only set on the site's very first launch: the lookup table, signed in the same approval. */
export type Prepared = {
  tx: string;
  message: string;
  mint: string;
  lastValidBlockHeight: number;
  tokens: string;
  maxLamports: string;
  setup: { table: string; expected: string[]; txs: string[]; messages: string[] } | null;
};

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/**
 * One atomic transaction: create the coin, open its fee-sharing config, set the shares to
 * 80% recipient / 20% treasury (which also revokes the admin, so the split is permanent),
 * and optionally the dev buy. Simulated before it is returned.
 */
export async function prepareLaunch(o: { draft: Draft; launcher: string; mint: string; recipient: string; treasury: string; metadataUri: string; split?: { address: string; shareBps: number }[] }): Promise<Prepared> {
  const user = key(o.launcher, "launcher");
  const mint = key(o.mint, "mint");
  if (!PublicKey.isOnCurve(user.toBytes()) || !PublicKey.isOnCurve(mint.toBytes())) throw Error("Launcher and mint must be signing keys.");
  if ([o.launcher, o.recipient, o.treasury].includes(o.mint)) throw Error("The mint must be a new key.");
  const uri = new URL(o.metadataUri);
  if (uri.protocol !== "https:" || o.metadataUri.length > 200) throw Error("Metadata must be a short https link.");
  // Squad coins pass their own split (treasury plus up to 8 members); everything else is 80/20.
  const split = (o.split ?? shares(o.recipient, o.treasury)).map((s) => ({ address: key(s.address, "fee"), shareBps: s.shareBps }));
  if (split.length > 10 || split.reduce((n, s) => n + s.shareBps, 0) !== 10_000 || split.some((s) => s.address.equals(mint))) throw Error("Bad fee split.");
  const lamports = initialBuyLamports(o.draft.initialBuy);

  const conn = connection();
  const accounts = await conn.getMultipleAccountsInfoAndContext([GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, mint], "confirmed");
  const [g, f, existing] = accounts.value;
  if (!g?.owner.equals(PUMP_PROGRAM_ID) || !f?.owner.equals(PUMP_FEE_PROGRAM_ID)) throw Error("pump.fun is unavailable right now, try again.");
  if (existing) throw Error("That coin address is taken. Try again for a fresh one.");
  const global = PUMP_SDK.decodeGlobal(g);
  if (!global.initialized || !global.createV2Enabled) throw Error("pump.fun isn't accepting new coins right now.");

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: await priorityFee(conn) }),
    await PUMP_SDK.createV2Instruction({
      user,
      creator: user,
      mint,
      name: o.draft.name,
      symbol: o.draft.ticker,
      uri: o.metadataUri,
      // Each of these takes over creator fees and would break the 80/20 split.
      mayhemMode: false,
      cashback: false,
      holderReward: false,
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    }),
    await PUMP_SDK.createFeeSharingConfig({ creator: user, mint, pool: null }),
    await PUMP_SDK.updateFeeShares({ authority: user, mint, currentShareholders: [user], newShareholders: split, bondingCurveComplete: false }),
  ];

  let tokens = "0";
  if (lamports > 0n) {
    const buyback = global.buybackFeeRecipients.find((k) => !k.equals(PublicKey.default));
    if (!buyback) throw Error("pump.fun's fee settings are unavailable, try again.");
    const amount = sdk.getBuyTokenAmountFromSolAmount({
      global,
      feeConfig: PUMP_SDK.decodeFeeConfig(f),
      mintSupply: null,
      bondingCurve: null,
      amount: new BN(lamports.toString()),
      quoteMint: NATIVE_MINT,
    });
    if (amount.lten(0)) throw Error("Dev buy is too small.");
    tokens = amount.toString();
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(user, getAssociatedTokenAddressSync(mint, user, false, TOKEN_2022_PROGRAM_ID), user, mint, TOKEN_2022_PROGRAM_ID),
      await PUMP_SDK.getBuyInstructionRaw({
        user,
        mint,
        creator: feeSharingConfigPda(mint),
        amount,
        solAmount: new BN(lamports.toString()),
        feeRecipient: global.feeRecipient,
        buybackFeeRecipient: buyback,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      }),
    );
  }

  const latest = await conn.getLatestBlockhash({ commitment: "confirmed", minContextSlot: accounts.context.slot });
  let table = await loadLookupTable();
  let setup: Prepared["setup"] = null;
  if (!table) {
    // First launch on the site: the same approval also creates the shared lookup table.
    const addresses = await tableAddresses(o.treasury);
    const built = await buildTable(o.launcher, addresses, latest.blockhash);
    table = built.account;
    setup = {
      table: built.table,
      expected: addresses.map((a) => a.toBase58()),
      txs: built.txs.map((t) => b64(t.serialize())),
      messages: built.txs.map((t) => b64(t.message.serialize())),
    };
  }
  const message = new TransactionMessage({ payerKey: user, recentBlockhash: latest.blockhash, instructions: ixs }).compileToV0Message([table]);
  const tx = new VersionedTransaction(message);
  let bytes: Uint8Array;
  try {
    bytes = tx.serialize();
  } catch {
    throw Error("That coin doesn't fit in one transaction. Shorten the name or skip the dev buy.");
  }
  if (bytes.length > 1232 || message.header.numRequiredSignatures !== 2) throw Error("Launch transaction is the wrong shape.");

  if (setup) {
    // The table isn't on chain yet so the launch can't be dry run; check the wallet can pay.
    const need = 0.05e9 + Number(lamports);
    if ((await conn.getBalance(user, "confirmed")) < need) throw Error("Not enough SOL in this wallet for the launch and dev buy.");
  } else {
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed", replaceRecentBlockhash: true });
    if (sim.value.err) {
      const logs = sim.value.logs ?? [];
      const broke = logs.some((l) => /insufficient lamports|InsufficientFunds/i.test(l));
      console.error("launch simulation", JSON.stringify(sim.value.err), logs.slice(-6));
      throw Error(broke ? "Not enough SOL in this wallet for the launch and dev buy." : "pump.fun rejected this launch in a dry run, try again.");
    }
  }
  return { tx: b64(bytes), message: b64(message.serialize()), mint: o.mint, lastValidBlockHeight: latest.lastValidBlockHeight, tokens, maxLamports: lamports.toString(), setup };
}

function decodeCurve(a: AccountInfo<Buffer>): BondingCurve {
  return PUMP_SDK.decodeBondingCurve(a);
}

export function checkSharing(c: SharingConfig, mint: string, recipient: string, treasury: string, split?: { address: string; shareBps: number }[]) {
  const want = split ?? shares(recipient, treasury);
  return (
    c.mint.toBase58() === mint &&
    c.adminRevoked === true &&
    c.shareholders.length === want.length &&
    want.every((w) => c.shareholders.some((s) => s.address.toBase58() === w.address && s.shareBps === w.shareBps))
  );
}

/** Reads a launched coin back off chain and confirms it is ours: 80/20 locked, no fee-diverting modes. */
export async function verifyLaunch(mint: string, recipient: string, treasury: string, split?: { address: string; shareBps: number }[]) {
  const m = key(mint, "mint");
  const conn = connection();
  const [sharing, curve] = await conn.getMultipleAccountsInfo([feeSharingConfigPda(m), bondingCurvePda(m)], "confirmed");
  if (!sharing?.owner.equals(PUMP_FEE_PROGRAM_ID) || !curve?.owner.equals(PUMP_PROGRAM_ID)) return { ok: false as const, reason: "not on chain yet" };
  const c = PUMP_SDK.decodeSharingConfig(sharing);
  const b = decodeCurve(curve);
  if (!checkSharing(c, mint, recipient, treasury, split)) return { ok: false as const, reason: "fee split doesn't match" };
  if (!b.creator.equals(feeSharingConfigPda(m)) || b.isMayhemMode || b.isCashbackCoin) return { ok: false as const, reason: "coin settings don't match" };
  return { ok: true as const, complete: b.complete };
}

/** SOL waiting in the coin's creator vault, ready to be paid out 80/20. */
export async function pendingFees(mint: string): Promise<number> {
  const vault = creatorVaultPda(feeSharingConfigPda(key(mint, "mint")));
  const conn = connection();
  const [lamports, rent] = await Promise.all([conn.getBalance(vault, "confirmed"), conn.getMinimumBalanceForRentExemption(0)]);
  return Math.max(0, lamports - rent) / 1e9;
}

/** The creator vault every fee payout for this coin comes from (used to total fees per recipient). */
export const vaultOf = (mint: string) => creatorVaultPda(feeSharingConfigPda(key(mint, "mint"))).toBase58();

/** Unsigned payout transaction. Anyone can send it; the payer only covers the network fee. */
export async function collectTx(mint: string, payer: string, priorityMicroLamports?: number) {
  const m = key(mint, "mint");
  const p = key(payer, "payer");
  const conn = connection();
  const online = new OnlinePumpSdk(conn);
  const { instructions } = await online.buildDistributeCreatorFeesInstructions(m, { payer: p });
  const latest = await conn.getLatestBlockhash("finalized");
  const message = new TransactionMessage({
    payerKey: p,
    recentBlockhash: latest.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports ?? await priorityFee(conn) }), ...instructions],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed", replaceRecentBlockhash: true });
  if (sim.value.err) {
    if (sim.value.err === "BlockhashNotFound") throw Error("Creator fee RPC blockhash unavailable");
    console.error("collect simulation", JSON.stringify(sim.value.err), sim.value.logs?.slice(-6));
    throw Error("Not enough fees to pay out yet, try again later.");
  }
  return { tx: Buffer.from(tx.serialize()).toString("base64"), lastValidBlockHeight: latest.lastValidBlockHeight };
}

/** The lookup tables a message uses, read from chain, so its accounts can be compared. */
async function tablesOf(m: VersionedTransaction["message"]) {
  const conn = connection();
  const keys = tablesFor(m);
  const found = await Promise.all(keys.map((k) => conn.getAddressLookupTable(k, { commitment: "confirmed" })));
  return found.flatMap((r) => (r.value ? [r.value] : []));
}

/**
 * Sends the signed launch through our RPC, but only if it still holds exactly the
 * instructions we built (wallets may add their own priority fee and safety checks, nothing
 * else) and both the launcher and the mint signed it.
 */
export async function broadcastLaunch(signedB64: string, expectedMessage: string) {
  const raw = Buffer.from(signedB64, "base64");
  if (raw.length > 1232) throw Error("Transaction too large.");
  const tx = VersionedTransaction.deserialize(raw);
  const expected = VersionedMessage.deserialize(Buffer.from(expectedMessage, "base64"));
  if (!matchesPrepared(tx.message, expected, await tablesOf(expected))) throw Error("Your wallet changed the launch, so it wasn't sent. Nothing was spent.");
  if (tx.signatures.length !== 2 || tx.signatures.some((s) => s.every((b) => b === 0))) throw Error("The launch is missing a signature.");
  return connection().sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
}

/**
 * First launch only: sends the signed lookup-table transactions in order and waits until the
 * table is usable. Each must be exactly the message we built and signed by the launcher.
 */
export async function broadcastSetup(signed: string[], expectedMessages: string[]) {
  if (signed.length !== expectedMessages.length) throw Error("The launch is missing a signature.");
  const conn = connection();
  for (let i = 0; i < signed.length; i++) {
    const raw = Buffer.from(signed[i], "base64");
    const tx = VersionedTransaction.deserialize(raw);
    if (!matchesPrepared(tx.message, VersionedMessage.deserialize(Buffer.from(expectedMessages[i], "base64")))) throw Error("Your wallet changed the launch, so it wasn't sent. Nothing was spent.");
    if (tx.signatures.length !== 1 || tx.signatures[0].every((b) => b === 0)) throw Error("The launch is missing a signature.");
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
    const res = await conn.confirmTransaction(sig, "confirmed");
    if (res.value.err) throw Error("The network rejected the launch. Try again.");
  }
}

/**
 * Where a sent launch stands. Until its blockhash expires it is re-sent on every check, so a
 * dropped packet doesn't strand it; once expired with no record on chain, it never landed.
 */
export async function launchProgress(raw: string, signature: string, lastValidBlockHeight: number): Promise<"landed" | "failed" | "expired" | "pending"> {
  const conn = connection();
  const [st] = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value;
  if (st?.err) return "failed";
  if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return "landed";
  // Wallets may swap in a fresher blockhash while signing, so allow some slack past ours.
  if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight + 150) return st ? "pending" : "expired";
  await conn.sendRawTransaction(Buffer.from(raw, "base64"), { skipPreflight: true, maxRetries: 0 }).catch(() => {});
  return "pending";
}
