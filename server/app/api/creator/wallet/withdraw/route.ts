import { NextRequest } from "next/server";
import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { wallets, transactions, creator_settings, users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { createTransferRecipient, initiateTransfer } from "@/lib/services/paystack";
import { sendWithdrawalRequestedEmail } from "@/lib/services/email";

const schema = z.object({
  amount: z.number().positive(),
});

/**
 * POST /api/creator/wallet/withdraw
 *
 * Withdraw earnings to the creator's SAVED bank account via a real Paystack
 * transfer. Bank details are read server-side from creator_settings — the
 * client-supplied bank fields are ignored so a withdrawal can never target an
 * account other than the one the creator verified.
 *
 * Flow:
 *   1. Reserve funds (atomic conditional debit + "processing" transaction).
 *   2. Create a Paystack transfer recipient + initiate the transfer.
 *   3. If initiation fails, refund the wallet and mark the withdrawal failed.
 *   4. OTP-required transfers are returned to the client to finalize.
 *   5. Final status (success/failed) is settled by the Paystack webhook.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;
  const amount = parsed.data.amount;

  // ── Authoritative bank details (server-side, never the request body) ─────
  const [settings] = await db
    .select({ bank_details: creator_settings.bank_details })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, auth.user.userId))
    .limit(1);

  let bank: {
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
    bankCode?: string;
  } = {};
  try {
    bank = settings?.bank_details ? JSON.parse(settings.bank_details) : {};
  } catch {
    bank = {};
  }

  if (!bank.accountNumber || !bank.bankCode || !bank.accountName) {
    return err(
      "Add your bank details before withdrawing",
      400,
      "BANK_DETAILS_REQUIRED",
    );
  }

  const now = new Date().toISOString();
  const txId = generateId();
  const reference = `wd_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // ── 1. Reserve funds ──────────────────────────────────────────────────────
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
        status: "processing",
        reference,
        description: `Withdrawal to ${bank.accountNumber} (${bank.bankCode})`,
        metadata: JSON.stringify({
          bank_name: bank.bankName,
          account_number: bank.accountNumber,
          account_name: bank.accountName,
          bank_code: bank.bankCode,
        }),
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "INSUFFICIENT_BALANCE") {
      return err("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
    }
    if (e instanceof Error && e.message === "WALLET_NOT_FOUND") {
      return err("Wallet not found", 404);
    }
    throw e;
  }

  // ── 2. Send real money via Paystack ───────────────────────────────────────
  try {
    const recipientCode = await createTransferRecipient({
      name: bank.accountName,
      accountNumber: bank.accountNumber,
      bankCode: bank.bankCode,
    });
    const transfer = await initiateTransfer({
      recipientCode,
      amountNaira: amount,
      reference,
      reason: "MeetSweet creator withdrawal",
    });

    const settled = transfer.status === "otp" ? "pending" : transfer.status === "success" ? "completed" : "processing";
    await db
      .update(transactions)
      .set({
        status: settled,
        paystack_ref: transfer.transferCode,
        updated_at: new Date().toISOString(),
      })
      .where(eq(transactions.id, txId));

    // ── Best-effort confirmation email ─────────────────────────────────────
    try {
      const [userRow] = await db
        .select({ email: users.email, full_name: users.full_name })
        .from(users)
        .where(eq(users.id, auth.user.userId))
        .limit(1);
      if (userRow?.email) {
        await sendWithdrawalRequestedEmail({
          to: userRow.email,
          name: userRow.full_name ?? userRow.email,
          amount,
          currency: "NGN",
          bankName: bank.bankName ?? null,
          accountNumber: bank.accountNumber ?? null,
        }).catch(() => null);
      }
    } catch {
      // Non-critical
    }

    return ok({
      success: true,
      id: txId,
      amount,
      status: settled,
      transfer_code: transfer.transferCode,
      otp_required: transfer.status === "otp",
    });
  } catch (e) {
    // No money moved — refund the reserved funds and mark the withdrawal failed.
    await db.transaction(async (tx) => {
      await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${amount}`, updated_at: new Date().toISOString() })
        .where(eq(wallets.user_id, auth.user.userId));
      await tx
        .update(transactions)
        .set({ status: "failed", updated_at: new Date().toISOString() })
        .where(eq(transactions.id, txId));
    });
    return err(
      e instanceof Error ? e.message : "Withdrawal failed",
      502,
      "PAYSTACK_TRANSFER_FAILED",
    );
  }
}
