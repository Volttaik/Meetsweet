/**
 * Idempotent wallet-credit helper for verified bank-transfer deposits.
 *
 * Shared by the Paystack `charge.success` webhook and the on-demand
 * "confirm transaction" route so a single deposit can never be credited twice.
 * The transaction is transitioned pending → success with a conditional update,
 * so a concurrent retry (double webhook delivery / double-tap) matches zero
 * rows and is a no-op.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, wallets, users } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { sendWalletDepositEmail } from "@/lib/services/email";

export async function creditDeposit(opts: {
  txId: string;
  userId: string;
  amountNaira: number;
  currency: string;
  paystackReference: string;
}): Promise<{ credited: boolean; newBalance: number }> {
  const now = new Date().toISOString();

  const [transitioned] = await db
    .update(transactions)
    .set({
      status: "success",
      paystack_ref: opts.paystackReference,
      updated_at: now,
    })
    .where(and(eq(transactions.id, opts.txId), ne(transactions.status, "success")))
    .returning({ id: transactions.id });

  const [wallet] = await db
    .select({ id: wallets.id, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, opts.userId))
    .limit(1);

  if (!transitioned) {
    // Already credited (this retry lost the atomic transition) — return the
    // current balance WITHOUT crediting again.
    return { credited: false, newBalance: wallet?.balance ?? 0 };
  }

  let newBalance: number;
  if (wallet) {
    // Atomic increment (not read-modify-write) so concurrent deposits can't
    // lose one another's credit.
    await db
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${opts.amountNaira}`, updated_at: now })
      .where(eq(wallets.id, wallet.id));
    newBalance = (wallet.balance ?? 0) + opts.amountNaira;
  } else {
    await db.insert(wallets).values({
      id: generateId(),
      user_id: opts.userId,
      balance: opts.amountNaira,
      currency: opts.currency,
    });
    newBalance = opts.amountNaira;
  }

  // Confirmation email — best-effort, never blocks or rolls back the credit.
  try {
    const [userRow] = await db
      .select({ email: users.email, full_name: users.full_name })
      .from(users)
      .where(eq(users.id, opts.userId))
      .limit(1);
    if (userRow?.email) {
      await sendWalletDepositEmail({
        to: userRow.email,
        name: userRow.full_name ?? userRow.email,
        amount: opts.amountNaira,
        currency: opts.currency,
        newBalance,
      }).catch(() => null);
    }
  } catch {
    // Non-critical
  }

  return { credited: true, newBalance };
}
