import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 100);

  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, auth.user.userId),
        eq(transactions.type, "withdrawal"),
      ),
    )
    .orderBy(desc(transactions.created_at))
    .limit(limit);

  const withdrawals = rows.map((row) => {
    let bankName = "";
    let accountNumber = "";
    try {
      const meta = row.metadata ? JSON.parse(row.metadata) : {};
      bankName = meta.bankName ?? meta.bank_name ?? "";
      accountNumber = meta.accountNumber ?? meta.account_number ?? "";
    } catch {
      // ignore parse errors
    }
    return {
      id: row.id,
      amount: row.amount,
      status: row.status,
      bankName,
      accountNumber,
      createdAt: row.created_at,
    };
  });

  return ok({ withdrawals });
}
