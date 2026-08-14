import { NextRequest } from "next/server";
import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({
  amount: z.number().positive(),
  bank_name: z.string().optional(),
  account_number: z.string().optional(),
  account_name: z.string().optional(),
  bank_code: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const { amount, bank_name, account_number, account_name, bank_code } = parsed.data;

  const now = new Date().toISOString();
  const txId = generateId();
  const reference = `wd_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Atomic debit + withdrawal record. The conditional balance update prevents
  // double withdrawals under concurrent/duplicate requests.
  try {
    await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select({ id: wallets.id, balance: wallets.balance })
        .from(wallets)
        .where(eq(wallets.user_id, auth.user.userId))
        .limit(1);

      if (!wallet) throw new Error("WALLET_NOT_FOUND");
      if ((wallet.balance ?? 0) < amount) throw new Error("INSUFFICIENT_BALANCE");

      const [debited] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${amount}`, updated_at: now })
        .where(and(eq(wallets.id, wallet.id), gte(wallets.balance, amount)))
        .returning({ id: wallets.id });
      if (!debited) throw new Error("INSUFFICIENT_BALANCE");

      await tx.insert(transactions).values({
        id: txId,
        user_id: auth.user.userId,
        type: "withdrawal",
        amount,
        currency: "NGN",
        status: "pending",
        reference,
        description: `Withdrawal to ${account_number ?? ""} (${bank_code ?? bank_name ?? "bank"})`,
        metadata: JSON.stringify({ bank_name, account_number, account_name, bank_code }),
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "WALLET_NOT_FOUND") {
      return err("Wallet not found", 404);
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      return err("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
    }
    throw error;
  }

  return ok({
    success: true,
    id: txId,
    amount,
    status: "pending",
  });
}
