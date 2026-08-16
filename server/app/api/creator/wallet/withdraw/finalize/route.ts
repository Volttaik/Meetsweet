import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { finalizeTransfer } from "@/lib/services/paystack";

const schema = z.object({
  transfer_code: z.string().min(1),
  otp: z.string().min(1),
});

/**
 * POST /api/creator/wallet/withdraw/finalize
 *
 * Finalizes a Paystack transfer that was returned with status "otp". On
 * success the withdrawal stays "processing" until the webhook marks it
 * "completed"; on failure the reserved funds are refunded and it is marked
 * "failed".
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;
  const { transfer_code, otp } = parsed.data;

  const [tx] = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.paystack_ref, transfer_code),
        eq(transactions.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!tx || tx.type !== "withdrawal") return err("Withdrawal not found", 404);

  try {
    const transfer = await finalizeTransfer(transfer_code, otp);
    const settled = transfer.status === "success" ? "completed" : "processing";
    await db
      .update(transactions)
      .set({ status: settled, updated_at: new Date().toISOString() })
      .where(eq(transactions.id, tx.id));
    return ok({ success: true, status: settled });
  } catch (e) {
    // Refund + mark failed only if not already settled by the webhook.
    await db.transaction(async (t) => {
      const [current] = await t
        .select({ status: transactions.status })
        .from(transactions)
        .where(eq(transactions.id, tx.id))
        .limit(1);
      if (current && current.status !== "completed" && current.status !== "failed") {
        await t
          .update(wallets)
          .set({ balance: sql`${wallets.balance} + ${tx.amount}`, updated_at: new Date().toISOString() })
          .where(eq(wallets.user_id, tx.user_id));
        await t
          .update(transactions)
          .set({ status: "failed", updated_at: new Date().toISOString() })
          .where(eq(transactions.id, tx.id));
      }
    });
    return err(
      e instanceof Error ? e.message : "Could not finalize transfer",
      502,
      "PAYSTACK_TRANSFER_FAILED",
    );
  }
}
