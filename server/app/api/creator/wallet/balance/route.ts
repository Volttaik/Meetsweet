import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [wallet] = await db
    .select({ balance: wallets.balance, currency: wallets.currency })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const balance = wallet?.balance ?? 0;

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

  const pending_balance = Number(pendingRow?.total ?? 0);
  const availableForWithdrawal = Math.max(0, balance - pending_balance);

  return ok({
    balance,
    currency: wallet?.currency ?? "NGN",
    pending_balance,
    pendingBalance: pending_balance,
    available_for_withdrawal: availableForWithdrawal,
    availableForWithdrawal,
  });
}
