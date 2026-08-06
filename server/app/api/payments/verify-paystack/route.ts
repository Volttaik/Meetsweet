import { NextRequest } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { config } from "@/lib/config";
import { generateId } from "@/lib/auth/codes";

/**
 * POST /api/payments/verify-paystack
 * 
 * Verifies a wallet deposit transaction.
 * Used by mobile app to check if payment was successful.
 * 
 * Request body:
 * - transactionId: string
 * 
 * Response:
 * - success: boolean
 * - amountAdded: number
 * - newBalance: number
 * - message?: string
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Mobile sends { reference } (the Paystack reference from initiate-paystack).
  // Legacy clients may send { transactionId } (our internal DB id) — support both.
  let body: { reference?: string; transactionId?: string };
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  const { reference: paystackRef, transactionId } = body;
  if (!paystackRef && !transactionId) {
    return err("reference or transactionId is required", 400);
  }

  const now = new Date().toISOString();

  // Look up by Paystack reference first (mobile path), fall back to internal ID (legacy)
  const [tx] = paystackRef
    ? await db
        .select()
        .from(transactions)
        .where(or(eq(transactions.reference, paystackRef), eq(transactions.id, paystackRef)))
        .limit(1)
    : await db.select().from(transactions).where(eq(transactions.id, transactionId!)).limit(1);

  if (!tx) {
    return err("Transaction not found", 404);
  }

  // Ownership check: prevent one user from crediting their wallet via another user's transaction
  if (tx.user_id !== auth.user.userId) {
    return err("Transaction not found", 404); // 404 not 403 to avoid leaking existence
  }

  // If already processed, return current state
  if (tx.status === "success") {
    const [wallet] = await db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, auth.user.userId))
      .limit(1);

    return ok({
      success: true,
      amountAdded: tx.amount,
      newBalance: wallet?.balance ?? 0,
      message: "Transaction already credited",
    });
  }

  const secretKey = config.paystack.secretKey();
  if (!secretKey) {
    return err("Paystack is not configured", 503, "PAYSTACK_NOT_CONFIGURED");
  }

  if (!tx.reference) return err("Transaction has no Paystack reference", 400);

  let json: {
    status: boolean;
    message?: string;
    data?: { status: string; amount: number; currency?: string; reference?: string };
  };
  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(tx.reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    json = await response.json() as typeof json;

    if (!response.ok || !json.status || !json.data) {
      return err(json.message ?? "Unable to verify payment with Paystack", 502, "PAYSTACK_VERIFY_FAILED");
    }
  } catch (error) {
    console.error("Paystack verify error:", error);
    return err("Unable to verify payment with Paystack", 502, "PAYSTACK_VERIFY_FAILED");
  }

  if (json.data.status !== "success") {
    return ok({
      success: false,
      amountAdded: 0,
      newBalance: 0,
      message: `Payment status: ${json.data.status}`,
    });
  }

  const amount = json.data.amount / 100;
  if (json.data.currency && json.data.currency !== tx.currency) {
    return err("Payment currency does not match the transaction", 400, "PAYMENT_MISMATCH");
  }
  if (amount !== tx.amount) {
    return err("Payment amount does not match the transaction", 400, "PAYMENT_MISMATCH");
  }

  // Mark the transaction before crediting it. The already-successful branch
  // above makes repeated verification idempotent for normal client retries.
  await db
    .update(transactions)
    .set({
      status: "success",
      paystack_ref: json.data.reference ?? tx.reference,
      updated_at: now,
    })
    .where(eq(transactions.id, tx.id));

  const [wallet] = await db
    .select({ id: wallets.id, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const newBalance = (wallet?.balance ?? 0) + amount;
  if (wallet) {
    await db
      .update(wallets)
      .set({ balance: newBalance, updated_at: now })
      .where(eq(wallets.id, wallet.id));
  } else {
    await db.insert(wallets).values({
      id: generateId(),
      user_id: auth.user.userId,
      balance: amount,
      currency: tx.currency,
    });
  }

  return ok({
    success: true,
    amountAdded: amount,
    newBalance,
    message: "Payment verified successfully",
  });
}
