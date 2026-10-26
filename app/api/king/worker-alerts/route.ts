import { timingSafeEqual, randomUUID } from "node:crypto";
import { redis, getJson } from "@/lib/redis";
import type { State } from "@/lib/king-worker/journal";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const KEY = "pt:king:worker:alerts";
function authorized(req: Request) {
  const secret = process.env.KING_ALERT_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? ""),
    b = Buffer.from("Bearer " + secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function POST(req: Request) {
  if (!authorized(req))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 4096)
    return Response.json({ error: "Too large" }, { status: 413 });
  let b: { event?: string; hour?: string };
  try {
    b = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    typeof b.event !== "string" ||
    !/^[a-zA-Z0-9_.:-]{1,100}$/.test(b.event) ||
    (b.hour !== undefined && !/^2026-\d{2}-\d{2}T\d{2}Z$/.test(b.hour))
  )
    return Response.json({ error: "Invalid event" }, { status: 400 });
  const event = {
    id: randomUUID(),
    event: b.event,
    hour: b.hour ?? null,
    at: Date.now(),
  };
  // Atomically dedupe and retain a bounded durable inbox. No credentials or tx bytes.
  await redis(
    "EVAL",
    "if redis.call('SET',KEYS[1],'1','NX','EX',3600) then redis.call('LPUSH',KEYS[2],ARGV[1]) redis.call('LTRIM',KEYS[2],0,499) end return 1",
    2,
    KEY + ":dedupe:" + b.event + ":" + (b.hour ?? ""),
    KEY,
    JSON.stringify(event),
  );
  return Response.json({ ok: true });
}
export async function GET(req: Request) {
  if (!authorized(req))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [raw, s] = await Promise.all([
    redis<string[]>("LRANGE", KEY, 0, 99),
    getJson<State>("pt:king:worker:v1"),
  ]);
  return Response.json({
    alerts: raw.map((x) => JSON.parse(x)),
    worker: s
      ? {
          at: s.at,
          outcome: s.outcome,
          testPassed: s.testPassed,
          stopped: s.stopped,
          launches: s.launches.map((l) => ({
            mint: l.mint,
            signature: l.signature,
            status: l.status,
          })),
          hours: Object.entries(s.hours).map(([hour, h]) => ({
            hour,
            paidWallets: Object.keys(h.paid).length,
            burnDone: h.burnDone,
            acknowledged: h.acknowledged,
          })),
        }
      : null,
    enabled: process.env.KING_WORKER_ENABLED === "true",
  });
}
