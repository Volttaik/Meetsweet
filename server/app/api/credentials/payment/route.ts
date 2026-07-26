import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { config } from "@/lib/config";
import { z } from "zod";

const initSchema = z.object({
  amount:   z.number().int().positive("amount must be a positive integer (kobo)"),
  email:    z.string().email("Invalid email address"),
  currency: z.enum(["NGN", "GHS", "ZAR", "USD"]).default("NGN"),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * POST /api/credentials/payment
 *
 * Paystack credential broker — the secret key never leaves this server.
 *
 * The mobile app submits the transaction details; the server calls Paystack's
 * Initialize Transaction API and returns the reference + authorization URL so
 * the app can complete payment directly with Paystack.
 *
 * Body (JSON):
 *   amount    — amount in the smallest currency unit (kobo for NGN)
 *   email     — customer email address
 *   currency  — "NGN" | "GHS" | "ZAR" | "USD"  (default: "NGN")
 *   metadata  — optional key/value pairs passed through to Paystack
 *
 * Response:
 *   reference         — unique transaction reference (store this to verify later)
 *   authorization_url — redirect the user here to complete payment
 *   access_code       — Paystack access code for the Paystack popup/SDK
 *   initiated_by      — userId of the authenticated caller
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const secretKey = config.paystack.secretKey();
  if (!secretKey) return err("Paystack is not configured on this broker", 503);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("Request body must be valid JSON", 400);
  }

  const parsed = initSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => e.message).join(", ");
    return err(msg, 422);
  }

  const { amount, email, currency, metadata } = parsed.data;

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      email,
      currency,
      metadata: {
        ...metadata,
        broker_user_id: auth.user.userId,
      },
    }),
  });

  const json = (await response.json()) as {
    status: boolean;
    message: string;
    data?: {
      reference: string;
      authorization_url: string;
      access_code: string;
    };
  };

  if (!response.ok || !json.status || !json.data) {
    console.error("[payment broker] Paystack error:", json.message);
    return err(json.message ?? "Failed to initialize payment", 502);
  }

  return ok({
    reference:         json.data.reference,
    authorization_url: json.data.authorization_url,
    access_code:       json.data.access_code,
    initiated_by:      auth.user.userId,
  });
}
