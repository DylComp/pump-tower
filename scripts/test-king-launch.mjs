// Explicitly authorized one-launch test. Repeated successful calls never launch more coins.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.king.local", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
try {
  const r = await fetch("https://pumptowers.fun/api/cron/king-worker", {
    method: "POST",
    headers: { authorization: "Bearer " + env.KING_LAUNCH_SECRET },
    signal: AbortSignal.timeout(290000),
  });
  const d = await r.json();
  console.log(
    JSON.stringify({
      status: r.status,
      outcome: d.outcome,
      error: d.error,
      testPassed: d.testPassed,
      launches: d.launches,
      stopped: d.stopped,
    }),
  );
  if (!r.ok) process.exitCode = 1;
} catch {
  console.log(
    JSON.stringify({
      error: "test_request_unresolved_check_journal_before_retry",
    }),
  );
  process.exitCode = 1;
}
