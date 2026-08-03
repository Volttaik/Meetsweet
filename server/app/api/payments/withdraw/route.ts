import { NextRequest } from "next/server";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { wallets, creator_withdrawals, creator_bank_details, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const withdrawSchema = z.object({
  amount: z.number().positive().int(),
  bankDetails: z.object({
    bankName: z.string().min(1),
    accountNumber: z.string().min(5).max(20),
    accountName: z.string().min(1),
  }).optional(),
});

/**
 * POST /api/payments/withdraw
 *
 * Request a withdrawal from the creator's wallet balance.
 * Validates sufficient balance and creates a pending withdrawal request.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Check if user is a creator
  if (auth.user.role !== "creator" && auth.user.role !== "admin") {
    return err("Only creators can withdraw funds", 403);
  }

  const parsed = await parseBody(req, withdrawSchema);
  if (!parsed.success) return parsed.response;

  const { amount, bankDetails } = parsed.data;

  // Get wallet balance
  const [wallet] = await db
    .select({ id: wallets.id, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const balance = wallet?.balance ?? 0;

  // Get pending withdrawals
  const [pendingResult] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${creator_withdrawals.amount}), 0)`,
    })
    .from(creator_withdrawals)
    .where(
      sql`${creator_withdrawals.user_id} = ${auth.user.userId} AND ${creator_withdrawals.status} IN ('pending', 'processing')`,
    );

  const pendingWithdrawals = Number(pendingResult?.total ?? 0);
  const availableBalance = Math.max(0, balance - pendingWithdrawals);

  if (amount > availableBalance) {
    return err("Insufficient available balance for withdrawal", 400, "INSUFFICIENT_BALANCE");
  }

  // Minimum withdrawal amount
  const MIN_WITHDRAWAL = 1000; // NGN 1,000
  if (amount < MIN_WITHDRAWAL) {
    return err(`Minimum withdrawal amount is NGN ${MIN_WITHDRAWAL.toLocaleString()}`, 400);
  }

  // Get bank details - either from request or stored
  let bankName: string;
  let accountNumber: string;
  let accountName: string;

  if (bankDetails) {
    bankName = bankDetails.bankName;
    accountNumber = bankDetails.accountNumber;
    accountName = bankDetails.accountName;

    // Save these bank details for future use
    const [existing] = await db
      .select({ id: creator_bank_details.id })
      .from(creator_bank_details)
      .where(eq(creator_bank_details.user_id, auth.user.userId))
      .limit(1);

    if (existing) {
      await db
        .update(creator_bank_details)
        .set({
          bank_name: bankName,
          account_number: accountNumber,
          account_name: accountName,
          updated_at: new Date().toISOString(),
        })
        .where(eq(creator_bank_details.id, existing.id));
    } else {
      await db.insert(creator_bank_details).values({
        id: generateId(),
        user_id: auth.user.userId,
        bank_name: bankName,
        account_number: accountNumber,
        account_name: accountName,
      });
    }
  } else {
    // Try to get stored bank details
    const [stored] = await db
      .select({
        bank_name: creator_bank_details.bank_name,
        account_number: creator_bank_details.account_number,
        account_name: creator_bank_details.account_name,
      })
      .from(creator_bank_details)
      .where(eq(creator_bank_details.user_id, auth.user.userId))
      .limit(1);

    if (!stored) {
      return err("Bank details required. Please provide bank details or save them first.", 400);
    }

    bankName = stored.bank_name;
    accountNumber = stored.account_number;
    accountName = stored.account_name;
  }

  const withdrawalId = generateId();
  const now = new Date().toISOString();

  // Create withdrawal record and deduct from wallet in a transaction
  await db.transaction(async (tx) => {
    // Deduct from wallet
    await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} - ${amount}`,
        updated_at: now,
      })
      .where(
        and(
          eq(wallets.id, wallet!.id),
          sql`${wallets.balance} >= ${amount}`,
        ),
      );

    // Create withdrawal record
    await tx.insert(creator_withdrawals).values({
      id: withdrawalId,
      user_id: auth.user.userId,
      amount,
      status: "pending",
      bank_name: bankName,
      account_number: accountNumber,
      account_name: accountName,
      reference: `WD-${Date.now()}`,
    });

    // Record the transaction
    await tx.insert(transactions).values({
      id: generateId(),
      user_id: auth.user.userId,
      type: "withdrawal",
      amount: -amount,
      status: "success",
      description: `Withdrawal to ${bankName} (${accountNumber})`,
      metadata: JSON.stringify({
        withdrawal_id: withdrawalId,
        bank_name: bankName,
        account_number: accountNumber,
        account_name: accountName,
      }),
    });
  });

  return ok({
    success: true,
    withdrawal_id: withdrawalId,
    amount,
    status: "pending",
    bank_name: bankName,
    account_number: accountNumber.slice(-4).padStart(accountNumber.length, "*"),
    message: "Withdrawal request submitted successfully",
  });
}
