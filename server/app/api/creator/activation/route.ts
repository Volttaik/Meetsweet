/**
 * Creator Activation Payment
 *
 * Flow: Normal user → Attempts to become creator → Sees ₦1,000 activation
 * screen → Pays via Paystack → Server verifies transaction → Sets
 * creator_activation_paid = true → Activates is_creator = true → Creator
 * functionality unlocked.
 *
 * The server must verify the Paystack transaction — the client must never
 * trust a client-side "payment successful" to unlock creator functionality.
 */

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { db } from "@/lib/db";
import { users, creator_settings, transactions } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { DEFAULT_SUBSCRIPTION_PRICE } from "@/lib/services/pricing";
import { config } from "@/lib/config";

const ACTIVATION_AMOUNT_NAIRA = 1000; // ₦1,000 one-time fee
const activationSchema = z.object({ email: z.string().email().optional() });

/**
 * Step 1: Initiate the ₦1,000 creator activation payment.
 * Creates a Paystack transaction and returns the authorization URL.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const parsed = await parseBody(req, activationSchema);
  if (!parsed.success) return parsed.response;

  const [user] = await db
    .select({ id: users.id, email: users.email, is_verified: users.is_verified, is_creator: users.is_creator, creator_activation_paid: users.creator_activation_paid })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);
  if (user.creator_activation_paid || user.is_creator) {
    return err("Creator already activated", 409);
  }

  // Account email is authoritative. The optional client value only repairs
  // legacy accounts whose email column is empty; it is never required when the
  // authenticated account already has one.
  const email = user.email?.trim().toLowerCase() || parsed.data.email?.trim().toLowerCase();
  if (!email) return err("Add an email address to your account before starting creator activation", 422, "EMAIL_REQUIRED");
  if (!user.email?.trim() && parsed.data.email) {
    await db.update(users).set({ email, updated_at: new Date().toISOString() }).where(eq(users.id, user.id));
  }
  if (!user.is_verified) return err("Verify your account email before starting creator activation", 422, "EMAIL_NOT_VERIFIED");

  const reference = `creator_activation_${auth.user.userId}_${Date.now()}`;
  const transactionId = generateId();

  await db.insert(transactions).values({
    id: transactionId,
    user_id: auth.user.userId,
    type: "creator_activation",
    amount: ACTIVATION_AMOUNT_NAIRA,
    currency: "NGN",
    status: "pending",
    reference,
    description: "Creator activation fee",
  });

  // Build a Paystack checkout URL
  const key = config.paystack.secretKey();
  if (!key) return err("Payment provider not configured", 503);

  // Use Paystack's initialize endpoint directly
  const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: ACTIVATION_AMOUNT_NAIRA * 100, // kobo
      reference,
      metadata: {
        type: "creator_activation",
        user_id: auth.user.userId,
        transaction_id: transactionId,
      },
      channels: ["card", "bank", "ussd", "qr", "mobile_money"],
    }),
  });

  const paystackJson = await paystackRes.json() as {
    status: boolean;
    message?: string;
    data?: { authorization_url?: string; reference?: string; access_code?: string };
  };

  if (!paystackRes.ok || !paystackJson.status || !paystackJson.data?.authorization_url) {
    return err(paystackJson.message ?? "Could not initiate payment", 502);
  }

  // Store the Paystack reference on the transaction
  await db
    .update(transactions)
    .set({ paystack_ref: paystackJson.data.reference ?? reference })
    .where(eq(transactions.id, transactionId));

  return created({
    transactionId,
    reference: paystackJson.data.reference ?? reference,
    authorizationUrl: paystackJson.data.authorization_url,
    amount: ACTIVATION_AMOUNT_NAIRA,
  });
}