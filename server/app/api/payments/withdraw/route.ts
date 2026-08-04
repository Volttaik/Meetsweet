import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const bankDetailsSchema = z.object({
  bankName: z.string().min(1),
  accountNumber: z.string().min(1),
  accountName: z.string().min(1),
});

const schema = z.object({
  amount: z.number().positive(),
  bankDetails: bankDetailsSchema,
});

/**
 * POST /api/payments/withdraw
 *
 * Initiates a creator withdrawal. Deducts the requested amount from the wallet
 * and records a pending withdrawal transaction.
 *
 * Request body:
 * - amount: number  (Naira)
 * - bankDetails: { bankName, accountNumber, accountName }
 *
 * Response:
 * - success: boolean
 * - withdrawalId: string
 * - status: "pending"
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if ("response" in parsed) return parsed.response;

  const { amount, bankDetails } = parsed.data;

  const [wallet] = await db
    .select({ id: wallets.id, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  if (!wallet) {
    return err("Wallet not found", 404);
  }

  if ((wallet.balance ?? 0) < amount) {
    return err("Insufficient balance", 400);
  }

  const now = new Date().toISOString();
  const withdrawalId = generateId();
  const reference = `wd_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Deduct from wallet
  const newBalance = (wallet.balance ?? 0) - amount;
  await db
    .update(wallets)
    .set({ balance: newBalance, updated_at: now })
    .where(eq(wallets.id, wallet.id));

  // Record withdrawal transaction
  await db.insert(transactions).values({
    id: withdrawalId,
    user_id: auth.user.userId,
    type: "withdrawal",
    amount,
    currency: "NGN",
    status: "pending",
    reference,
    description: `Withdrawal to ${bankDetails.bankName} — ${bankDetails.accountNumber}`,
    metadata: JSON.stringify(bankDetails),
  });

  return ok({
    success: true,
    withdrawalId,
    withdrawal_id: withdrawalId,
    status: "pending",
  });
}
