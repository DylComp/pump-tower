// Read only: outputs sanitized worker status and alerts. Never prints env values.
import { readFileSync } from "node:fs";
const path = new URL("../.env.king.local", import.meta.url);
const env = Object.fromEntries(
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
try {
  const r = await fetch("https://pumptowers.fun/api/king/worker-alerts", {
    headers: { authorization: "Bearer " + env.KING_ALERT_SECRET },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    console.log(
      JSON.stringify({ error: "alert_endpoint_unavailable", status: r.status }),
    );
    process.exitCode = 1;
  } else console.log(JSON.stringify(await r.json()));
} catch {
  console.log(JSON.stringify({ error: "alert_endpoint_unreachable" }));
  process.exitCode = 1;
}
