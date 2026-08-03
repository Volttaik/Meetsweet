import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, creator_withdrawals } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

/**
 * GET /api/payments/balance
 *
 * Returns the creator's wallet balance information including:
 * - total balance
 * - pending withdrawals
 * - available for withdrawal
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Get wallet balance
  const [wallet] = await db
    .select({
      balance: wallets.balance,
    })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const balance = wallet?.balance ?? 0;

  // Get pending withdrawals total
  const [pendingResult] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${creator_withdrawals.amount}), 0)`,
    })
    .from(creator_withdrawals)
    .where(
      sql`${creator_withdrawals.user_id} = ${auth.user.userId} AND ${creator_withdrawals.status} IN ('pending', 'processing')`,
    );

  const pendingWithdrawals = Number(pendingResult?.total ?? 0);
  const availableForWithdrawal = Math.max(0, balance - pendingWithdrawals);

  return ok({
    balance,
    pending_withdrawals: pendingWithdrawals,
    pendingWithdrawals,
    available_for_withdrawal: availableForWithdrawal,
    availableForWithdrawal,
    currency: "NGN",
  });
}
