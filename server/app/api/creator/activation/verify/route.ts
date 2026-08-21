/**
 * Verify creator activation payment.
 *
 * POST — the mobile app calls this after Paystack redirect. The server
 * verifies the transaction with Paystack's API. Never trusts the client to
 * report "payment successful". On successful verification:
 *   1. Sets creator_activation_paid = true
 *   2. Sets is_creator = true
 *   3. Creates creator_settings with default price
 *   4. Returns the updated user state
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { db } from "@/lib/db";
import { users, transactions } from "@/lib/db/schema";
import { config } from "@/lib/config";
import { settleCreatorActivation } from "@/lib/services/referrals";
import { sendPushToUser } from "@/lib/services/push";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(
    req,
    z.object({
      transactionId: z.string().min(1),
      reference: z.string().optional(),
    }),
  );
  if (!parsed.success) return parsed.response;

  // Check if already activated (idempotent — re-verification is safe)
  const [user] = await db
    .select({ id: users.id, is_creator: users.is_creator, creator_activation_paid: users.creator_activation_paid })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);
  if (user.creator_activation_paid && user.is_creator) {
    return ok({ activated: true, already_activated: true, is_creator: true });
  }

  // Look up the pending transaction
  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, parsed.data.transactionId))
    .limit(1);

  if (!tx) return err("Transaction not found", 404);
  if (tx.user_id !== auth.user.userId) return err("Transaction does not belong to you", 403);

  // Verify with Paystack
  const key = config.paystack.secretKey();
  if (!key) return err("Payment provider not configured", 503);

  const reference = parsed.data.reference ?? tx.reference ?? tx.paystack_ref;
  if (!reference) return err("No payment reference found", 400);

  const verifyRes = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const verifyJson = await verifyRes.json() as {
    status: boolean;
    message?: string;
    data?: {
      status?: string;
      amount?: number;
      reference?: string;
      metadata?: { type?: string; user_id?: string };
    };
  };

  if (!verifyRes.ok || !verifyJson.status) {
    return err(verifyJson.message ?? "Payment verification failed", 502);
  }

  const paystackData = verifyJson.data;
  if (!paystackData || paystackData.status !== "success") {
    return err(`Payment not completed (status: ${paystackData?.status ?? "unknown"})`, 402, "PAYMENT_INCOMPLETE");
  }

  // Verify the amount is correct (₦1,000)
  if (paystackData.amount !== 1000 * 100) {
    return err("Payment amount mismatch", 400, "AMOUNT_MISMATCH");
  }

  // ── Payment verified — settle activation + referral reward atomically ────
  try {
    const settled = await settleCreatorActivation(
      auth.user.userId,
      parsed.data.transactionId,
      paystackData.reference ?? reference,
    );
    if (settled.referrerId && settled.rewardAmount > 0) {
      void sendPushToUser(settled.referrerId, {
        title: "Referral Reward",
        body: "You received ₦200 in your MeetSweet wallet.",
        data: { type: "referral_reward", wallet: true, referred_user_id: auth.user.userId },
      }, "notif_creator_updates");
    }
    return ok({
      activated: settled.activated,
      already_activated: settled.alreadyActivated,
      referral_reward: settled.rewardAmount,
      is_creator: true,
      creator_activation_paid: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") return err("User not found", 404);
    if (error instanceof Error && error.message === "INVALID_ACTIVATION_TRANSACTION") {
      return err("Invalid creator activation transaction", 400, "INVALID_ACTIVATION_TRANSACTION");
    }
    throw error;
  }
}