import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { refreshClaimedFees } from "../launch/registry";
import { reconcileAttempt } from "./reconcile.ts";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { connection, collectTx, verifyLaunch } from "../launch/pump";
import { allSquadCoins, reign } from "../king/store";
import type { Reign } from "../king/model";
import { buybackChain, verifyBuybackPlan } from "../buyback/buyback-chain.ts";
import type { BuybackPolicy } from "../buyback/buyback-model.ts";
import {
  openJournal,
  type Journal,
  type Attempt,
  type Launch,
} from "./journal";
import {
  DEV,
  TREASURY,
  MINT,
  END,
  LAUNCH_MIN,
  RESERVE,
  checkedReign,
  checkLaunch,
  assertBudget,
} from "./safety.ts";
const ORIGIN = "https://pumptowers.fun";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const decode = (s: string) =>
  VersionedTransaction.deserialize(Buffer.from(s, "base64"));
const encode = (t: VersionedTransaction) =>
  Buffer.from(t.serialize()).toString("base64");
const signature = (t: VersionedTransaction) => bs58.encode(t.signatures[0]);
function signer(name: string, address: string) {
  const raw = process.env[name];
  if (!raw) throw Error("missing_" + name);
  let k: Keypair;
  try {
    k = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    throw Error("invalid_" + name);
  }
  if (k.publicKey.toBase58() !== address)
    throw Error("wallet_mismatch_" + name);
  return k;
}
async function api(path: string, body?: unknown, secret?: string) {
  const r = await fetch(ORIGIN + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: "Bearer " + secret } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(65_000),
  });
  // Never surface response bodies: they may contain transaction bytes or provider URLs.
  if (!r.ok && r.status !== 202)
    throw Error(
      "api_" + path.split("?")[0].replaceAll("/", "_") + "_" + r.status,
    );
  return { status: r.status, data: await r.json() };
}
export async function alert(event: string, hour?: string) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    const message = `Pump Towers King worker: ${event}${hour ? " (" + hour + ")" : ""}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(url === ORIGIN + "/api/king/worker-alerts"
          ? { authorization: "Bearer " + process.env.KING_ALERT_SECRET }
          : {}),
      },
      body: JSON.stringify({ text: message, content: message, event, hour }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
async function settle(j: Journal, a: Attempt) {
  const c = connection();
  return reconcileAttempt(j, a, c, async (attempt) => {
    const state = await buybackChain(c, attempt.plan.policy).reconcile(attempt);
    if (
      state.kind !== "settled" ||
      !state.receipt.success ||
      BigInt(state.receipt.burned) <= 0n
    )
      throw Error("burn_receipt_mismatch");
  });
}
async function finishLaunch(j: Journal, l: Launch, deadline: number) {
  if (l.status !== "pending") return l.status === "finalized";
  // Confirm first: send may have landed before a prior invocation timed out.
  const c = connection();
  const receipt = await c.getTransaction(l.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (receipt?.meta?.err) {
    l.status = "failed";
    await j.save();
    throw Error("launch_failed");
  }
  if (!receipt) {
    if ((await c.getBlockHeight("finalized")) > l.expires)
      throw Error("launch_expired_unresolved");
    await j.fence();
    await api("launch/send", { mint: l.mint, tx: l.tx, setup: l.setup });
  }
  while (Date.now() < deadline - 8000) {
    const r = await api("king/launch/confirm", { mint: l.mint });
    if (r.data.coin) {
      if (r.data.coin.mint !== l.mint || r.data.coin.groupId !== l.groupId)
        throw Error("launch_confirmation_mismatch");
      const tx = await c.getTransaction(l.signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (tx?.meta && !tx.meta.err) {
        l.status = "finalized";
        j.state.testPassed = true;
        await j.save();
        return true;
      }
    }
    await pause(2500);
  }
  return false;
}
async function launches(
  j: Journal,
  launcher: Keypair,
  test: boolean,
  deadline: number,
) {
  for (const l of j.state.launches.filter((l) => l.status === "pending")) {
    try {
      if (!(await finishLaunch(j, l, deadline))) return;
    } catch {
      j.state.outcome = "launch_reconciliation_failed";
      await j.save();
      await alert(j.state.outcome);
    }
  }
  if (test && j.state.testPassed) return;
  if (
    Date.now() >= END ||
    (!test && Date.now() - j.state.lastLaunchAt < 600_000)
  )
    return;
  j.state.lastLaunchAt = Date.now();
  await j.save();
  const { data } = await api("king/launch/next");
  let count = 0;
  for (const s of data.squads) {
    if (count >= (test ? 1 : 5) || Date.now() > deadline - 70_000) break;
    // An uncertain launch permanently reserves its squad until reconciled.
    if (
      j.state.launches.some(
        (l) => l.groupId === s.groupId && l.status !== "failed",
      )
    )
      continue;
    if (
      (await connection().getBalance(launcher.publicKey, "confirmed")) <
      LAUNCH_MIN
    ) {
      j.state.outcome = "launcher_below_0.1_SOL";
      await j.save();
      await alert(j.state.outcome);
      return;
    }
    try {
      const mint = Keypair.generate();
      const { data: p } = await api(
        "king/launch/prepare",
        {
          groupId: s.groupId,
          mint: mint.publicKey.toBase58(),
          launcher: launcher.publicKey.toBase58(),
        },
        process.env.KING_LAUNCH_SECRET,
      );
      const tx = decode(p.tx);
      checkLaunch(tx, launcher.publicKey, mint.publicKey);
      const setup = p.setup
        ? p.setup.map((raw: string) => {
            const t = decode(raw);
            checkLaunch(t, launcher.publicKey);
            t.sign([launcher]);
            return encode(t);
          })
        : null;
      tx.sign([launcher, mint]);
      if (!Number.isSafeInteger(p.lastValidBlockHeight))
        throw Error("missing_launch_expiry");
      const l: Launch = {
        groupId: s.groupId,
        mint: mint.publicKey.toBase58(),
        tx: encode(tx),
        setup,
        signature: signature(tx),
        expires: p.lastValidBlockHeight,
        status: "pending",
      };
      count++;
      j.state.launches.push(l);
      await j.save();
      await finishLaunch(j, l, deadline);
    } catch {
      j.state.outcome = "squad_launch_failed";
      await j.save();
      await alert(j.state.outcome);
    }
  }
}
async function refreshCollection(a: Attempt) {
  // Older pending records predate the mint field; recover it from their signed message.
  const mint = a.mint ?? (await allSquadCoins()).find(c => decode(a.signed).message.staticAccountKeys.some(k => k.toBase58() === c.mint))?.mint;
  if (!mint) throw Error("collection_mint_unknown");
  await refreshClaimedFees(mint, a.signature);
}
async function collections(j: Journal, treasury: Keypair, deadline: number) {
  if (j.state.collection?.failed) {
    delete j.state.collection;
    await j.save();
  }
  if (j.state.collection) {
    if (!(await settle(j, j.state.collection))) return;
    await refreshCollection(j.state.collection);
    delete j.state.collection;
    await j.save();
  }
  const { data } = await api("king");
  const coins = await allSquadCoins();
  const listed = new Set(
    data.squads.flatMap((s: { coin?: { mint: string } }) =>
      s.coin ? [s.coin.mint] : [],
    ),
  );
  const eligible = coins.filter((c) => listed.has(c.mint));
  for (let n = 0; n < eligible.length && Date.now() < deadline - 15_000; n++) {
    const coin = eligible[j.state.coinOffset % eligible.length];
    j.state.coinOffset++;
    await j.save();
    if (
      !(
        await verifyLaunch(
          coin.mint,
          coin.shares[1].address,
          TREASURY,
          coin.shares,
        )
      ).ok
    )
      throw Error("collection_split_mismatch");
    const c = connection(),
      before = await c.getBalance(treasury.publicKey, "confirmed");
    if (BigInt(before) < RESERVE + 100_000n) return;
    let built;
    try {
      built = await collectTx(coin.mint, TREASURY, 1000);
    } catch (e) {
      if (e instanceof Error && e.message === "Not enough fees to pay out yet, try again later.") continue;
      throw Error("collection_prepare_failed");
    }
    const tx = decode(built.tx);
    checkLaunch(tx, treasury.publicKey);
    const fee = (await c.getFeeForMessage(tx.message, "confirmed")).value;
    if (fee === null || fee > 100_000) throw Error("collection_fee_limit");
    const sim = await c.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [TREASURY] },
    });
    if (
      sim.value.err ||
      !sim.value.accounts?.[0] ||
      sim.value.accounts[0].lamports - before < 100_000
    )
      continue;
    tx.sign([treasury]);
    j.state.collection = {
      mint: coin.mint,
      signed: encode(tx),
      signature: signature(tx),
      expires: built.lastValidBlockHeight,
      status: "pending",
    };
    await j.save();
    if (!(await waitSettlement(j, j.state.collection, deadline))) return;
    await refreshCollection(j.state.collection);
    delete j.state.collection;
    await j.save();
  }
}
async function waitSettlement(j: Journal, a: Attempt, deadline: number) {
  while (Date.now() < deadline - 15_000) {
    if (await settle(j, a)) return true;
    await pause(2500);
  }
  return false;
}
async function payouts(j: Journal, treasury: Keypair, deadline: number) {
  const { data } = await api("king/payouts?status=pending&count=500");
  const pending = (data.reigns as Reign[]).sort((a, b) =>
    a.hour.localeCompare(b.hour),
  );
  for (const r of pending) {
    let again = true;
    while (again && Date.now() < deadline - 50_000) {
      again = false;
      if (Date.now() > deadline - 50_000) break;
      try {
        const checked = checkedReign(r);
        let h = j.state.hours[r.hour];
        if (!h) {
          h = {
            digest: checked.digest,
            paid: {},
            attempts: [],
            burnDone: checked.burn === 0n,
            acknowledged: false,
          };
          j.state.hours[r.hour] = h;
          await j.save();
        }
        if (h.digest !== checked.digest) throw Error("hour_allocation_changed");
        // Reconcile all persisted batches before constructing any new transfer.
        let unsettled = false;
        for (const a of h.attempts.filter((a) => !a.failed)) {
          if (!(await waitSettlement(j, a, deadline))) {
            unsettled = true;
            break;
          }
          for (const wallet of a.wallets ?? []) h.paid[wallet] = a.signature;
          if (a.burn)
            h.burnDone =
              h.attempts
                .filter((x) => x.burn && x.status === "finalized" && !x.failed)
                .reduce((n, x) => n + BigInt(x.burn!.plan.inputCap), 0n) >=
              checked.burn;
          await j.save();
        }
        if (unsettled) return;
        const remaining = r.payouts.filter((p) => !h.paid[p.wallet]);
        const burnedBudget = h.attempts
          .filter((a) => a.burn && a.status === "finalized" && !a.failed)
          .reduce((n, a) => n + BigInt(a.burn!.plan.inputCap), 0n);
        const burnRemaining = checked.burn - burnedBudget;
        const spend =
          remaining.reduce((n, p) => n + BigInt(p.lamports), 0n) +
          burnRemaining;
        const c = connection();
        // Include network overhead and protect this hour's carried balance as well as reserve.
        assertBudget(
          BigInt(await c.getBalance(treasury.publicKey, "confirmed")),
          spend,
          BigInt(Math.ceil(remaining.length / 8)) * 5000n +
            ((burnRemaining + 9_999_999_999n) / 10_000_000_000n) * 10_000_000n,
          checked.rollover,
        );
        if (remaining.length) {
          const batch = remaining.slice(0, 8),
            block = await c.getLatestBlockhash("confirmed");
          const tx = new VersionedTransaction(
            new TransactionMessage({
              payerKey: treasury.publicKey,
              recentBlockhash: block.blockhash,
              instructions: batch.map((p) =>
                SystemProgram.transfer({
                  fromPubkey: treasury.publicKey,
                  toPubkey: new PublicKey(p.wallet),
                  lamports: BigInt(p.lamports),
                }),
              ),
            }).compileToV0Message(),
          );
          const fee = (await c.getFeeForMessage(tx.message, "confirmed")).value;
          if (fee === null || fee > 5000) throw Error("payout_fee_limit");
          tx.sign([treasury]);
          const a: Attempt = {
            signed: encode(tx),
            signature: signature(tx),
            expires: block.lastValidBlockHeight,
            status: "pending",
            wallets: batch.map((p) => p.wallet),
          };
          h.attempts.push(a);
          await j.save();
          await settle(j, a);
          again = true;
          continue;
        }
        if (!h.burnDone) {
          // Provision the new treasury's PTWR account once, with a durable receipt.
          const mintKey = new PublicKey(MINT),
            mintAccount = await c.getAccountInfo(mintKey, "finalized");
          if (
            !mintAccount ||
            ![TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some((p) =>
              p.equals(mintAccount.owner),
            )
          )
            throw Error("unsupported_mint_owner");
          const ata = getAssociatedTokenAddressSync(
            mintKey,
            treasury.publicKey,
            false,
            mintAccount.owner,
          );
          if (!(await c.getAccountInfo(ata, "confirmed"))) {
            const block = await c.getLatestBlockhash("confirmed");
            const tx = new VersionedTransaction(
              new TransactionMessage({
                payerKey: treasury.publicKey,
                recentBlockhash: block.blockhash,
                instructions: [
                  createAssociatedTokenAccountIdempotentInstruction(
                    treasury.publicKey,
                    ata,
                    treasury.publicKey,
                    mintKey,
                    mintAccount.owner,
                  ),
                ],
              }).compileToV0Message(),
            );
            tx.sign([treasury]);
            const a: Attempt = {
              signed: encode(tx),
              signature: signature(tx),
              expires: block.lastValidBlockHeight,
              status: "pending",
            };
            h.attempts.push(a);
            await j.save();
            await settle(j, a);
            again = true;
            continue;
          }
          // Reuse the existing atomic exact-output purchase + burn, with this hour's allocation.
          const chunk =
            burnRemaining > 10_000_000_000n ? 10_000_000_000n : burnRemaining;
          const policy: BuybackPolicy = {
            purpose: "king-hour",
            treasury: TREASURY,
            mint: MINT,
            maxInput: chunk.toString(),
            maxOverhead: "10000000",
            dailyCap: (chunk + 10_000_000n).toString(),
            slippageBps: 100,
          };
          const plan = await buybackChain(c, policy).prepare(
            (chunk + 10_000_000n).toString(),
          );
          if (!plan) throw Error("burn_budget_unavailable");
          await verifyBuybackPlan(plan);
          const tx = decode(plan.unsigned);
          tx.sign([treasury]);
          const signed = encode(tx),
            sig = signature(tx);
          const a: Attempt = {
            signed,
            signature: sig,
            expires: plan.lastValidBlockHeight,
            status: "pending",
            burn: { id: "king:" + r.hour, plan, signed, signature: sig },
          };
          h.attempts.push(a);
          await j.save();
          await settle(j, a);
          again = true;
          continue;
        }
        const signatures = h.attempts
          .filter((a) => a.status === "finalized" && !a.failed)
          .map((a) => a.signature);
        await api(
          "king/payouts",
          { hour: r.hour, signatures },
          process.env.KING_PAYER_SECRET || process.env.CRON_SECRET,
        );
        h.acknowledged = true;
        await j.save();
      } catch {
        await alert("hour_failed", r.hour);
        j.state.outcome = "hour_failed:" + r.hour;
        await j.save();
        return;
      }
    }
  }
  // Stop only once the final eligible hour exists and all pending hours are paid.
  if (Date.now() >= END && pending.length === 0) {
    const final = await reign("2026-11-09T13Z");
    if (final?.status === "paid") {
      j.state.stopped = true;
      await j.save();
    }
  }
}
export async function runKingWorker(test = false) {
  if (process.env.KING_WORKER_ENABLED !== "true" && !test)
    return { outcome: "disabled" };
  const j = await openJournal();
  if (!j) return { outcome: "busy" };
  try {
    if (j.state.stopped) return { outcome: "competition_complete" };
    if (!process.env.KING_LAUNCH_SECRET)
      throw Error("missing_KING_LAUNCH_SECRET");
    const launcher = signer("KING_LAUNCHER_SECRET_KEY", DEV),
      treasury = signer("KING_TREASURY_SECRET_KEY", TREASURY);
    if (
      (await connection().getGenesisHash()) !==
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
    )
      throw Error("mainnet_required");
    if (!test && !process.env.ALERT_WEBHOOK_URL)
      throw Error("missing_ALERT_WEBHOOK_URL");
    // First funded scheduled invocation is restricted to one acceptance launch.
    const acceptanceOnly = test || !j.state.testPassed;
    const deadline = Date.now() + 235_000;
    j.state.outcome = "ok";
    await j.save();
    if (!acceptanceOnly) {
      if (BigInt(await connection().getBalance(treasury.publicKey, "confirmed")) < RESERVE) {
        j.state.outcome = "treasury_below_reserve";
        await j.save();
        await alert(j.state.outcome);
      }
      await payouts(j, treasury, deadline);
      if (!j.state.stopped) {
        try {
          await collections(
            j,
            treasury,
            Math.min(deadline, Date.now() + 60_000),
          );
        } catch {
          await alert("collection_failed");
          j.state.outcome = "collection_failed";
        }
      }
    }
    if (!j.state.stopped) await launches(j, launcher, acceptanceOnly, deadline);
    await j.save();
    return {
      outcome: j.state.outcome,
      testPassed: j.state.testPassed,
      launches: j.state.launches.map((l) => ({
        groupId: l.groupId,
        mint: l.mint,
        signature: l.signature,
        status: l.status,
      })),
      hours: Object.entries(j.state.hours).map(([hour, h]) => ({
        hour,
        paidWallets: Object.keys(h.paid).length,
        burnDone: h.burnDone,
        acknowledged: h.acknowledged,
      })),
      stopped: j.state.stopped,
    };
  } finally {
    await j.close();
  }
}
