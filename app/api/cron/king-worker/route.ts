import { timingSafeEqual } from "node:crypto";
import { runKingWorker, alert } from "@/lib/king-worker/worker";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
function authorized(req: Request, name: string) {
  const secret = process.env[name];
  if (!secret) return false;
  const expected = Buffer.from("Bearer " + secret),
    actual = Buffer.from(req.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function run(req: Request, test: boolean) {
  if (!authorized(req, test ? "KING_LAUNCH_SECRET" : "CRON_SECRET"))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runKingWorker(test));
  } catch {
    await alert("worker_failed");
    return Response.json(
      { error: "Worker failed; inspect configuration and durable journal" },
      { status: 503 },
    );
  }
}
export const GET = (req: Request) => run(req, false);
/** Explicit single-launch acceptance; persisted success prevents repeated test launches. */
export const POST = (req: Request) => run(req, true);
