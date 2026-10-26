import { randomUUID } from "node:crypto";
import { redis } from "../redis.ts";
import type { BuybackAttempt } from "../buyback/buyback-model.ts";
export type Attempt = {
  mint?: string;
  signed: string;
  signature: string;
  expires: number;
  status: "pending" | "finalized";
  wallets?: string[];
  burn?: BuybackAttempt;
  failed?: boolean;
};
export type Launch = {
  groupId: string;
  mint: string;
  tx: string;
  setup: string[] | null;
  signature: string;
  expires: number;
  status: "pending" | "finalized" | "failed";
};
export type Hour = {
  digest: string;
  paid: Record<string, string>;
  attempts: Attempt[];
  burnDone: boolean;
  acknowledged: boolean;
};
export type State = {
  testPassed: boolean;
  launches: Launch[];
  hours: Record<string, Hour>;
  collection?: Attempt;
  coinOffset: number;
  lastLaunchAt: number;
  stopped: boolean;
  outcome: string;
  at: number;
};
const KEY = "pt:king:worker:v1",
  LOCK = KEY + ":lock";
/** CAS plus a lease fences every broadcast. Signed bytes survive timeouts/redeployments. */
export async function openJournal(command: typeof redis = redis) {
  const lease = randomUUID();
  if ((await command("SET", LOCK, lease, "NX", "EX", 300)) !== "OK")
    return null;
  let expected = await command<string | null>("GET", KEY);
  const state: State = expected
    ? JSON.parse(expected)
    : {
        testPassed: false,
        launches: [],
        hours: {},
        coinOffset: 0,
        lastLaunchAt: 0,
        stopped: false,
        outcome: "new",
        at: 0,
      };
  return {
    state,
    async save() {
      state.at = Date.now();
      const next = JSON.stringify(state);
      const ok = await command(
        "EVAL",
        "if redis.call('GET',KEYS[1])~=ARGV[1] or (redis.call('GET',KEYS[2]) or '')~=ARGV[2] then return 0 end redis.call('SET',KEYS[2],ARGV[3]) return 1",
        2,
        LOCK,
        KEY,
        lease,
        expected ?? "",
        next,
      );
      if (ok !== 1) throw Error("journal_lease_lost");
      expected = next;
    },
    async fence() {
      if (
        (await command("GET", LOCK)) !== lease ||
        (await command("GET", KEY)) !== expected
      )
        throw Error("journal_lease_lost");
    },
    async close() {
      await command(
        "EVAL",
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
        1,
        LOCK,
        lease,
      );
    },
  };
}
export type Journal = NonNullable<Awaited<ReturnType<typeof openJournal>>>;
