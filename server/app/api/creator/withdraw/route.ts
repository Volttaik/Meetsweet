import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({
  amount: z.number().positive(),
  bank_code: z.string().min(1),
  account_number: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const { amount, bank_code, account_number } = parsed.data;

  // Check wallet balance
  const [wallet] = await db
    .select({ id: wallets.id, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  if (!wallet || (wallet.balance ?? 0) < amount) {
    return err("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
  }

  const now = new Date().toISOString();
  const txId = generateId();

  // Deduct from wallet
  await db
    .update(wallets)
    .set({ balance: (wallet.balance ?? 0) - amount, updated_at: now })
    .where(eq(wallets.id, wallet.id));

  // Create withdrawal transaction record
  await db.insert(transactions).values({
    id: txId,
    user_id: auth.user.userId,
    type: "debit",
    amount,
    currency: "NGN",
    status: "pending",
    description: `Withdrawal to ${account_number} (${bank_code})`,
    metadata: JSON.stringify({ bank_code, account_number }),
  });

  return ok({
    transaction_id: txId,
    amount,
    status: "pending",
    message: "Withdrawal request submitted. Funds will be processed within 1-3 business days.",
  });
}
