import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { verifyWebhookSignature } from "@/lib/services/paystack";

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
  if (
    ev !== "transfer.success" &&
    ev !== "transfer.failed" &&
    ev !== "transfer.reversed"
  ) {
    // Not a transfer event we settle here (e.g. charge.success) — acknowledge.
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
