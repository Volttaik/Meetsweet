import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { parseBody } from "@/lib/api/validate";
import { z } from "zod";

const initSchema = z.object({
  amount: z.number().int().positive(), // in kobo (NGN lowest unit)
  email: z.string().email(),
  metadata: z.record(z.unknown()).optional(),
  callback_url: z.string().url().optional(),
});

/**
 * POST /api/credentials/payment
 *
 * Initializes a Paystack transaction on the server (keeping the secret key
 * server-side) and returns the authorization URL and reference to the client.
 * The client opens the authorization URL in a WebView/browser to complete payment.
 * After payment, call POST /api/credentials/payment/verify with the reference
 * to confirm success.
 *
 * Auth required: Yes
 *
 * Request body:
 *   amount        — amount in kobo (e.g. 100000 = ₦1,000)
 *   email         — customer email address
 *   metadata      — optional key-value pairs (e.g. { plan: "creator_monthly" })
 *   callback_url  — optional URL Paystack redirects to after payment
 *
 * Response:
 *   authorization_url — open this in a WebView to collect payment
 *   reference         — save this; pass to /verify to confirm payment
 *   access_code       — Paystack access code (for Paystack.js inline popup)
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, initSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return err("Payment service not configured", 503);

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: body.amount,
      email: body.email,
      metadata: {
        user_id: auth.user.userId,
        ...body.metadata,
      },
      callback_url: body.callback_url,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    console.error("Paystack init failed:", text);
    return err("Failed to initialize payment", 502);
  }

  const json = await res.json();
  if (!json.status) return err(json.message ?? "Payment initialization failed", 502);

  return ok({
    authorization_url: json.data.authorization_url,
    reference: json.data.reference,
    access_code: json.data.access_code,
  });
}
