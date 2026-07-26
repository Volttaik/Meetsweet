import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { z } from "zod";
import { parseBody } from "@/lib/api/validate";

const verifySchema = z.object({
  reference: z.string().min(1),
});

/**
 * POST /api/credentials/payment/verify
 *
 * Verifies a Paystack transaction by reference (server-side).
 * Call this after the user completes the payment flow to confirm success
 * before unlocking any feature or content in the app.
 *
 * Auth required: Yes
 *
 * Request body:
 *   reference  — the reference returned by POST /api/credentials/payment
 *
 * Response:
 *   status      — "success" | "failed" | "abandoned" | "pending"
 *   amount      — amount charged in kobo
 *   currency    — e.g. "NGN"
 *   paid_at     — ISO timestamp of payment (if successful)
 *   metadata    — metadata attached at initialization
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, verifySchema);
  if (!parsed.success) return parsed.response;
  const { reference } = parsed.data;

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return err("Payment service not configured", 503);

  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${secretKey}` },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    console.error("Paystack verify failed:", text);
    return err("Failed to verify payment", 502);
  }

  const json = await res.json();
  if (!json.status) return err(json.message ?? "Verification failed", 502);

  const txn = json.data;

  // Guard: ensure this transaction belongs to the authenticated user
  if (txn.metadata?.user_id && txn.metadata.user_id !== auth.user.userId) {
    return err("Transaction does not belong to this user", 403);
  }

  return ok({
    status: txn.status,        // "success" | "failed" | "abandoned" | "pending"
    amount: txn.amount,        // in kobo
    currency: txn.currency,
    paid_at: txn.paid_at ?? null,
    metadata: txn.metadata ?? {},
  });
}
