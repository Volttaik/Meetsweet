import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { verifyWebhookSignature } from "@/lib/services/paystack";
import { settleCreatorActivation, CREATOR_ACTIVATION_NAIRA } from "@/lib/services/referrals";
import { notifyReferralReward } from "@/lib/services/notifications";

/**
 * POST /api/payments/paystack-webhook
 *
 * Receives Paystack events (unauthenticated — verified via the
 * x-paystack-signature HMAC-SHA512 header). Settles withdrawal transfers:
 *   transfer.success          → mark the withdrawal completed
 *   transfer.failed/reversed  → refund the reserved wallet funds + mark failed
 *
 * Register this URL in the Paystack dashboard (Settings → Webhooks).
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  if (!verifyWebhookSignature(body, signature)) {
    return new Response("invalid signature", { status: 401 });
  }

  let event: { event?: string; data?: Record<string, any> };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const ev = event.event ?? "";

  // Handle charge.success for creator_activation payments
  if (ev === "charge.success") {
    const data = event.data ?? {};
    const metadata = data.metadata ?? {};
    if (
      metadata.type === "creator_activation" &&
      metadata.user_id &&
      metadata.transaction_id &&
      Number(data.amount) === CREATOR_ACTIVATION_NAIRA * 100
    ) {
      await handleActivationSuccess(metadata.user_id, metadata.transaction_id, data.reference ?? "");
    }
    return new Response("ok", { status: 200 });
  }

  if (
    ev !== "transfer.success" &&
    ev !== "transfer.failed" &&
    ev !== "transfer.reversed"
  ) {
    // Not a recognized event — acknowledge.
    return new Response("ok", { status: 200 });
  }

  const data = event.data ?? {};
  const transferCode: string = data.transfer_code ?? data.transferCode ?? "";
  const reference: string = data.reference ?? "";

  const [tx] = transferCode
    ? await db
        .select()
        .from(transactions)
        .where(eq(transactions.paystack_ref, transferCode))
        .limit(1)
    : await db
        .select()
        .from(transactions)
        .where(eq(transactions.reference, reference))
        .limit(1);

  if (!tx || tx.type !== "withdrawal") {
    return new Response("ok", { status: 200 });
  }

  const now = new Date().toISOString();

  if (ev === "transfer.success") {
    if (tx.status !== "completed") {
      await db
        .update(transactions)
        .set({ status: "completed", updated_at: now })
        .where(eq(transactions.id, tx.id));
    }
  } else if (tx.status !== "completed" && tx.status !== "failed") {
    // Refund the reserved amount and mark failed (idempotent).
    await db.transaction(async (t) => {
      await t
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${tx.amount}`, updated_at: now })
        .where(eq(wallets.user_id, tx.user_id));
      await t
        .update(transactions)
        .set({ status: "failed", updated_at: now })
        .where(eq(transactions.id, tx.id));
    });
  }

  return new Response("ok", { status: 200 });
}

/** Settle activation only after the signed Paystack webhook and amount pass. */
async function handleActivationSuccess(
  userId: string,
  transactionId: string,
  paystackRef: string,
): Promise<void> {
  try {
    const settled = await settleCreatorActivation(userId, transactionId, paystackRef);
    if (settled.referrerId && settled.rewardAmount > 0) {
      // In-app row + push — deduped by (user, event) so Paystack webhook
      // replays can never double-notify the referrer.
      void notifyReferralReward({
        userId: settled.referrerId,
        referredUserId: userId,
        amount: settled.rewardAmount,
      });
    }
  } catch {
    // Non-critical — Paystack retries the webhook and the mobile verify path is idempotent.
  }
}
