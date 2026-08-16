import { NextRequest } from "next/server";
import { eq, and, sql, inArray } from "drizzle-orm";
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

  // In-flight withdrawals (awaiting OTP / Paystack processing). The withdraw
  // route debits the wallet at reservation time, so `balance` already excludes
  // these — pending_balance is informational only and must NOT be subtracted
  // again (doing so double-counted and under-reported available funds).
  const [pendingRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, auth.user.userId),
        eq(transactions.type, "withdrawal"),
        inArray(transactions.status, ["pending", "processing"]),
      ),
    );

  const pending_balance = Number(pendingRow?.total ?? 0);
  const availableForWithdrawal = Math.max(0, balance);

  return ok({
    balance,
    currency: wallet?.currency ?? "NGN",
    pending_balance,
    pendingBalance: pending_balance,
    available_for_withdrawal: availableForWithdrawal,
    availableForWithdrawal,
  });
}
