import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { creator_withdrawals } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

/**
 * GET /api/payments/withdrawal-history
 *
 * Returns the creator's withdrawal history.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const withdrawals = await db
    .select({
      id: creator_withdrawals.id,
      amount: creator_withdrawals.amount,
      status: creator_withdrawals.status,
      bank_name: creator_withdrawals.bank_name,
      account_number: creator_withdrawals.account_number,
      account_name: creator_withdrawals.account_name,
      reference: creator_withdrawals.reference,
      created_at: creator_withdrawals.created_at,
      updated_at: creator_withdrawals.updated_at,
    })
    .from(creator_withdrawals)
    .where(eq(creator_withdrawals.user_id, auth.user.userId))
    .orderBy(desc(creator_withdrawals.created_at))
    .limit(50);

  return ok({
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amount: w.amount,
      status: w.status,
      bankName: w.bank_name,
      bank_name: w.bank_name,
      accountNumber: w.account_number,
      account_number: w.account_number,
      accountName: w.account_name,
      account_name: w.account_name,
      reference: w.reference,
      createdAt: w.created_at,
      created_at: w.created_at,
      updatedAt: w.updated_at,
      updated_at: w.updated_at,
    })),
  });
}
