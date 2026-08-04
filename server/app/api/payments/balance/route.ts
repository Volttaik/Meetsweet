import { NextRequest } from "next/server";
import { eq, and, eq as eqAlias, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

/**
 * GET /api/payments/balance
 *
 * Returns the authenticated creator's wallet balance plus
 * pending-withdrawal summary.
 *
 * Response:
 * - balance: number
 * - pendingWithdrawals: number   (sum of pending withdrawal amounts)
 * - availableForWithdrawal: number
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [wallet] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const balance = wallet?.balance ?? 0;

  // Sum pending withdrawals
  const [pendingRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, auth.user.userId),
        eq(transactions.type, "withdrawal"),
        eq(transactions.status, "pending"),
      ),
    );

  const pendingWithdrawals = Number(pendingRow?.total ?? 0);
  const availableForWithdrawal = Math.max(0, balance - pendingWithdrawals);

  return ok({ balance, pendingWithdrawals, availableForWithdrawal });
}
