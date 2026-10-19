import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FEE_TIERS, FEE_TIER_NAMES, cleanDraft, feeTier, initialBuyLamports, metadataJson, profileStats, shares } from "./launch/model.ts";
import { parseQuery } from "./launch/profile.ts";
import { TIERS } from "./game.ts";

const wallet = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const other = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

test("drafts are cleaned and checked", () => {
  const d = cleanDraft({ name: " Tower Cat ", ticker: "$tcat", description: "", twitter: "https://x.com/cat", telegram: "", initialBuy: "0.5" });
  assert.equal(d.name, "Tower Cat");
  assert.equal(d.ticker, "TCAT");
  assert.throws(() => cleanDraft({ name: "", ticker: "A" }));
  assert.throws(() => cleanDraft({ name: "a", ticker: "TOOLONGTICKER" }));
  assert.throws(() => cleanDraft({ name: "a", ticker: "A", twitter: "http://x.com/a" }));
  assert.throws(() => cleanDraft({ name: "a", ticker: "A", twitter: "https://evil.com/a" }));
  assert.throws(() => cleanDraft({ name: "a", ticker: "A", telegram: "https://t.me.evil.com/a" }));
  assert.throws(() => cleanDraft({ name: "a".repeat(33), ticker: "A" }));
});

test("dev buy amounts", () => {
  assert.equal(initialBuyLamports(""), 0n);
  assert.equal(initialBuyLamports("1.5"), 1_500_000_000n);
  assert.throws(() => initialBuyLamports("11"));
  assert.throws(() => initialBuyLamports("0.0001"));
  assert.throws(() => initialBuyLamports("-1"));
  assert.throws(() => initialBuyLamports("1e3"));
});

test("fee split is 80/20 and needs two wallets", () => {
  assert.deepEqual(
    shares(wallet, other).map((s) => s.shareBps),
    [8000, 2000],
  );
  assert.throws(() => shares(wallet, wallet));
});

test("metadata always points the website at the coin's page", () => {
  const m = metadataJson(cleanDraft({ name: "a", ticker: "A" }), wallet, "https://x/i.png");
  assert.match(m.website, new RegExp(`/t/${wallet}$`));
});

test("fee tiers line up with room tiers", () => {
  assert.equal(FEE_TIERS.length, TIERS.length);
  assert.equal(FEE_TIER_NAMES.length, TIERS.length);
  assert.equal(feeTier(0), 0);
  assert.equal(feeTier(0.1), 1);
  assert.equal(feeTier(4.99), 2);
  assert.equal(feeTier(1000), 5);
});

test("pump user queries", () => {
  assert.deepEqual(parseQuery("@alice_1"), { username: "alice_1" });
  assert.deepEqual(parseQuery(`https://pump.fun/profile/${wallet}?tab=coins`), { wallet });
  assert.deepEqual(parseQuery("pump.fun/profile/bob"), { username: "bob" });
  assert.equal(parseQuery("<script>"), null);
});

test("the browser's program allowlist matches the SDK", async () => {
  const require = createRequire(import.meta.url);
  const sdk = require("@pump-fun/pump-sdk");
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../components/Launch.tsx", import.meta.url), "utf8"));
  for (const id of [sdk.PUMP_PROGRAM_ID.toBase58(), sdk.PUMP_FEE_PROGRAM_ID.toBase58()]) assert.ok(src.includes(id), id);
});

test("pump profiles roll up their coins", () => {
  const who = (w: string, username: string | null) => ({ wallet: w, username, image: null, x: null, followers: null });
  const coin = (mint: string, w: string, feesSol: number, mcapUsd: number | null, createdAt: number, username: string | null = "cat") => ({
    mint, name: mint, ticker: mint.toUpperCase(), createdAt, feesSol, recipientSol: feesSol * 0.8, mcapUsd, recipient: who(w, username),
  });
  const rows = profileStats([coin("a", wallet, 1, 10_000, 1, "old"), coin("b", wallet, 2, 50_000, 3, "new"), coin("c", other, 5, null, 2)]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].profile.wallet, other);
  const mine = rows[1];
  assert.equal(mine.coins, 2);
  assert.equal(mine.feesSol, 3);
  assert.equal(mine.recipientSol, 2.4000000000000004);
  assert.equal(mine.mcapUsd, 60_000);
  assert.equal(mine.top?.mint, "b");
  assert.equal(mine.profile.username, "new");
  assert.equal(rows[0].top?.mcapUsd, null);
});
