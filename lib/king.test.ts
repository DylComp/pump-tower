import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MEMBERS, MIN_PAYOUT_LAMPORTS, WSOL, coinName, coinTicker, launchable, pickKing, potLamports, sameShares, snapshotMinute, splitPot, squadShares, tradeLamports, type Member, type RpcTx } from "./king/model.ts";

const T = "pTWrBR7VzpAzztwYaLnot5sxP4a9tBJjyi1CLF4Xz1Z";
const w = (i: number) => "Abc" + "1".repeat(38) + String.fromCharCode(65 + i);
const m = (i: number, role = "MEMBER"): Member => ({ wallet: w(i), username: `u${i}`, role, joinedAt: 1000 + i, inCompetition: true });

test("squad shares: treasury half, members equal, owner first, capped", () => {
  const s = squadShares([m(2), m(1), m(0, "OWNER")], T);
  assert.equal(s[0].address, T);
  assert.equal(s.reduce((n, x) => n + x.shareBps, 0), 10_000);
  assert.deepEqual(s.slice(1).map((x) => x.address), [w(0), w(1), w(2)]);
  assert.equal(s[1].shareBps, 1666);
  assert.equal(s[0].shareBps, 10_000 - 1666 * 3);
  const big = squadShares(Array.from({ length: 20 }, (_, i) => m(i)), T);
  assert.equal(big.length, MAX_MEMBERS + 1);
  assert.equal(big.reduce((n, x) => n + x.shareBps, 0), 10_000);
  assert.throws(() => squadShares([], T));
  // The treasury and duplicate wallets are never paid twice.
  assert.equal(squadShares([m(1), m(1), { ...m(3), wallet: T }], T).length, 2);
  assert.ok(sameShares(s, [...s].reverse()));
});

test("squads named with slurs don't get coins", () => {
  for (const n of ["OnlyNiggers", "thejewishcabal", "rugandrape", "RetardCabal", "proRetards"]) assert.equal(launchable(n), false, n);
  for (const n of ["Underground", "Synagogue", "drillers", "Schizophrenics", "RaceRelations", "grapes"]) assert.equal(launchable(n), true, n);
});

test("coin names and tickers fit pump's limits", () => {
  assert.equal(coinName("Underground"), "Underground squad");
  assert.ok(new TextEncoder().encode(coinName("a".repeat(40))).length <= 32);
  assert.equal(coinTicker("CATEVENGERS"), "CATEVENGER");
  assert.equal(coinTicker("rug_and-rape"), "RUGANDRAPE");
  assert.equal(coinTicker("__"), "SQUAD");
});

test("king is the squad with a coin that banked the most SOL", () => {
  const banked = { a: -10, b: 40, c: 50, d: 500 };
  assert.deepEqual(pickKing(banked, new Set(["a", "b", "c"])), { groupId: "c", gainSol: 50 });
  assert.deepEqual(pickKing(banked, new Set(["a", "b", "c", "d"]), new Set(["d"])), { groupId: "c", gainSol: 50 });
  assert.equal(pickKing(banked, new Set(["a"])), null);
  assert.equal(pickKing(banked, new Set(["e"])), null);
});

test("banked SOL counts trades only, wrapped SOL included", () => {
  const W = "Wa11et1111111111111111111111111111111111111";
  const tb = (mint: string, amount: string, owner = W) => ({ owner, mint, uiTokenAmount: { amount } });
  const tx = (pre: number, post: number, preT: ReturnType<typeof tb>[], postT: ReturnType<typeof tb>[], err: unknown = null): RpcTx => ({
    blockTime: 1,
    meta: { err, preBalances: [pre, 5], postBalances: [post, 5], preTokenBalances: preT, postTokenBalances: postT },
    transaction: { message: { accountKeys: [W, "Other111111111111111111111111111111111111111"] } },
  });
  // Sold tokens for 2 SOL (minus fee).
  assert.equal(tradeLamports(tx(1e9, 2.99e9, [tb("Mint", "500")], [tb("Mint", "0")]), W), 1_990_000_000n);
  // Bought: negative.
  assert.equal(tradeLamports(tx(3e9, 2e9, [], [tb("Mint", "10")]), W), -1_000_000_000n);
  // Sold into wrapped SOL that stayed wrapped: still banked.
  assert.equal(tradeLamports(tx(1e9, 1e9 - 5000, [tb("Mint", "5"), tb(WSOL, "0")], [tb("Mint", "0"), tb(WSOL, "700000000")]), W), 699_995_000n);
  // A plain SOL transfer, a failed trade, someone else's tokens, a wallet not in the tx: not counted.
  assert.equal(tradeLamports(tx(1e9, 5e9, [], []), W), null);
  assert.equal(tradeLamports(tx(1e9, 2e9, [tb("Mint", "5")], [tb("Mint", "0")], { err: 1 }), W), null);
  assert.equal(tradeLamports(tx(1e9, 2e9, [tb("Mint", "5", "Else")], [tb("Mint", "0", "Else")]), W), null);
  assert.equal(tradeLamports(tx(1e9, 2e9, [tb("Mint", "5")], [tb("Mint", "0")]), "Nobody111111111111111111111111111111111111"), null);
  // Sold into USDC: counted at SOL's dollar price (200 USDC at $200 = 1 SOL), unknown price: not counted.
  const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  assert.equal(tradeLamports(tx(1e9, 1e9, [tb("Mint", "5")], [tb("Mint", "0"), tb(usdc, "200000000")]), W, 200), 1_000_000_000n);
  assert.equal(tradeLamports(tx(1e9, 1e9, [tb("Mint", "5")], [tb("Mint", "0"), tb(usdc, "200000000")]), W), null);
  // Sending tokens or USDC away while paying the fee: not a trade.
  assert.equal(tradeLamports(tx(1e9, 1e9 - 5000, [tb("Mint", "5")], [tb("Mint", "0")]), W), null);
  assert.equal(tradeLamports(tx(1e9, 1e9, [tb(usdc, "20000000")], [tb(usdc, "0")]), W, 200), null);
});

test("pot is the treasury half of fees earned in the hour", () => {
  assert.equal(potLamports({ x: "100", y: "0" }, { x: "300", y: "1000", z: "500" }), 600n);
  assert.equal(potLamports({ x: "300" }, { x: "300" }), 0n);
});

test("holders split pro rata, dust rolls over", () => {
  const pot = 1_000_000_000n;
  const { payouts, paid, rollover } = splitPot(pot, [
    { wallet: "a", amount: 6000n },
    { wallet: "b", amount: 3999n },
    { wallet: "c", amount: 1n },
    { wallet: "d", amount: 0n },
  ]);
  assert.deepEqual(payouts.map((p) => p.wallet), ["a", "b"]);
  assert.equal(payouts[0].lamports, "600000000");
  assert.ok(BigInt(payouts[1].lamports) >= MIN_PAYOUT_LAMPORTS);
  assert.equal(paid + rollover, pot);
  assert.equal(splitPot(pot, []).rollover, pot);
});

test("snapshot minute is fixed per hour and inside :05 to :55", async () => {
  const a = await snapshotMinute(3_600_000 * 5, "s");
  assert.equal(a, await snapshotMinute(3_600_000 * 5, "s"));
  for (let h = 0; h < 50; h++) {
    const x = await snapshotMinute(3_600_000 * h, "secret");
    assert.ok(x >= 5 && x <= 55);
  }
});

import { seedNewCoinFees, HOUR } from './king/model.ts';
test('new squad coins start at zero fees within their creation hour without resetting old baselines',()=>{
 const hour=Date.parse('2026-10-26T22:00:00Z');
 const seeded=seedNewCoinFees({old:'100',new:'12345'},[{mint:'old',createdAt:hour-1000},{mint:'new',createdAt:hour+1000},{mint:'unknownOld',createdAt:hour-1000},{mint:'future',createdAt:hour+HOUR}],hour);
 assert.deepEqual(seeded,{old:'100',new:'0'});
 assert.equal(potLamports(seeded,{old:'100',new:'2000000'}),1000000n);
});
