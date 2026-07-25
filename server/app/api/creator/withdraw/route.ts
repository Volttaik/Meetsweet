import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, withdrawals } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, created, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { z } from "zod";

const withdrawSchema = z.object({
  amount: z.number().positive(),
  bank_code: z.string().min(1),
  account_number: z.string().min(10).max(10),
  account_name: z.string().min(1),
  note: z.string().max(500).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  if (auth.user.role === "user") return err("Creator access required", 403);

  const rows = await db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.creator_id, auth.user.userId))
    .orderBy(desc(withdrawals.created_at))
    .limit(50);

  return ok({ withdrawals: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  if (auth.user.role === "user") return err("Creator access required", 403);

  const parsed = await parseBody(req, withdrawSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  // Check wallet balance
  const [wallet] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  if (!wallet || wallet.balance < body.amount) {
    return err("Insufficient balance", 400);
  }

  // Check no pending withdrawal
  const [pending] = await db
    .select({ id: withdrawals.id })
    .from(withdrawals)
    .where(
      and(
        eq(withdrawals.creator_id, auth.user.userId),
        eq(withdrawals.status, "pending")
      )
    )
    .limit(1);

  if (pending) return err("You already have a pending withdrawal request", 409);

  const ref = `wd_${generateId().replace(/-/g, "").slice(0, 20)}`;

  const withdrawalId = generateId();
  await db.insert(withdrawals).values({
    id: withdrawalId,
    creator_id: auth.user.userId,
    amount: body.amount,
    bank_code: body.bank_code,
    account_number: body.account_number,
    account_name: body.account_name,
    note: body.note,
    reference: ref,
    status: "pending",
  });

  // Deduct from wallet immediately (holds the funds)
  await db
    .update(wallets)
    .set({ balance: wallet.balance - body.amount })
    .where(eq(wallets.user_id, auth.user.userId));

  return created({ id: withdrawalId, reference: ref }, "Withdrawal request submitted");
}
