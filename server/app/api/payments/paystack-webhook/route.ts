import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { verifyWebhookSignature } from "@/lib/services/paystack";
import { creditDeposit } from "@/lib/services/deposit-credit";

/**
 * POST /api/payments/paystack-webhook
 *
 * Receives Paystack events (unauthenticated — verified via the
 * x-paystack-signature HMAC-SHA512 header). Settles both directions:
 *
 *   charge.success            → credit an in-app wallet top-up (dedicated NUBAN
 *                               bank transfer — the authoritative credit path)
 *   transfer.success          → mark a creator withdrawal completed
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
  const data = event.data ?? {};
  const now = new Date().toISOString();

  // ── In-app wallet top-up (dedicated virtual account bank transfer) ────────
  if (ev === "charge.success") {
    const channel: string = data.channel ?? data.authorization?.channel ?? "";
    if (channel !== "dedicated_nuban") {
      // A card/other charge — not our bank-transfer funding flow.
      return new Response("ok", { status: 200 });
    }

    const customerCode: string = data.customer?.customer_code ?? data.customer_code ?? "";
    const amountNaira = Math.round((Number(data.amount) ?? 0) / 100);
    const chargeReference: string = data.reference ?? "";
    if (!customerCode || !amountNaira || !chargeReference) {
      return new Response("ok", { status: 200 });
    }

    // Find a pending credit whose metadata carries this customer code and whose
    // amount matches. Parse in JS — metadata is a small JSON blob.
    const pending = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.type, "credit"), eq(transactions.status, "pending")));

    const match = pending.find((t) => {
      if (Number(t.amount) !== amountNaira) return false;
      try {
        const m = t.metadata ? JSON.parse(t.metadata) : {};
        return m.customer_code === customerCode;
      } catch {
        return false;
      }
    });

    if (!match) {
      // No matching pending deposit (already settled, or an unknown transfer).
      return new Response("ok", { status: 200 });
    }

    // Idempotency: never credit the same Paystack charge twice.
    const [alreadyUsed] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.paystack_ref, chargeReference))
      .limit(1);
    if (alreadyUsed) {
      return new Response("ok", { status: 200 });
    }

    await creditDeposit({
      txId: match.id,
      userId: match.user_id,
      amountNaira,
      currency: match.currency,
      paystackReference: chargeReference,
    });

    return new Response("ok", { status: 200 });
  }

  // ── Creator withdrawals (payouts) ─────────────────────────────────────────
  if (
    ev !== "transfer.success" &&
    ev !== "transfer.failed" &&
    ev !== "transfer.reversed"
  ) {
    // Not an event we settle here — acknowledge so Paystack stops retrying.
    return new Response("ok", { status: 200 });
  }

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
