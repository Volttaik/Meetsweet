import { NextRequest } from "next/server";
import { processDueSubscriptions } from "@/lib/services/subscription-renewal";
import { ok, unauthorized } from "@/lib/api/response";

/**
 * POST /api/cron/renew-subscriptions
 *
 * Vercel Cron trigger for monthly subscription auto-renewal. Runs regularly
 * (see vercel.json crons) to renew or expire subscriptions that are past their
 * `expires_at` — this happens regardless of whether the subscriber is online.
 *
 * Security: guarded by the CRON_SECRET env var. The request must carry it in
 * the `x-meetsweet-cron-secret` header. Without it, unauthorized is returned.
 * Idempotent — each due subscription is processed at most once per period, so
 * overlapping cron runs can never double-charge.
 */
export async function GET(req: NextRequest) {
  return handle(req, { auth: "GET", method: "GET" });
}

export async function POST(req: NextRequest) {
  return handle(req, { auth: "POST", method: "POST" });
}

async function handle(
  req: NextRequest,
  _opts: { auth: string; method: "GET" | "POST" },
) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const supplied = req.headers.get("x-meetsweet-cron-secret");
    if (!supplied || supplied !== secret) {
      return unauthorized("Unauthorized");
    }
  }

  try {
    const outcome = await processDueSubscriptions();
    return ok({ processed: true, ...outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ok({ processed: false, error: message });
  }
}