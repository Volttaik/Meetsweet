import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

/**
 * GET /api/payments/withdrawal-history
 *
 * Returns a paginated list of the authenticated user's withdrawal transactions.
 *
 * Query params:
 * - limit?: number (default 20)
 * - page?: number  (default 1)
 *
 * Response:
 * - withdrawals: Array<{ id, amount, status, bankName, accountNumber, createdAt }>
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { searchParams } = req.nextUrl;
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 100);

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
      bankName = meta.bankName ?? "";
      accountNumber = meta.accountNumber ?? "";
    } catch {
      // ignore parse errors
    }
    return {
      id: row.id,
      amount: row.amount,
      status: row.status,
      bankName,
      accountNumber,
      reference: row.reference,
      description: row.description,
      createdAt: row.created_at,
    };
  });

  return ok({ withdrawals });
}
