import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { config } from "@/lib/config";
import { listCustomerTransactions } from "@/lib/services/paystack";
import { creditDeposit } from "@/lib/services/deposit-credit";

/**
 * POST /api/payments/confirm-transfer
 *
 * On-demand verification for an in-app bank-transfer top-up. The client's
 * "Confirm Transaction" button is never trusted on its own: the server queries
 * Paystack for the customer's recent transactions and only credits the wallet
 * once it finds a successful `dedicated_nuban` transfer of the exact amount.
 *
 * Body: { transactionId: string }
 *
 * Response:
 * - success: boolean
 * - status: "success" | "pending" | "expired" | "failed"
 * - amountAdded / newBalance (only when success)
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  let body: { transactionId?: string };
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  const { transactionId } = body;
  if (!transactionId) {
    return err("transactionId is required", 400);
  }

  const [tx] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.user_id, auth.user.userId)))
    .limit(1);

  if (!tx) {
    return err("Transaction not found", 404);
  }

  // Already credited — return the current balance without re-crediting.
  if (tx.status === "success") {
    const [wallet] = await db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, auth.user.userId))
      .limit(1);
    return ok({
      success: true,
      status: "success",
      amountAdded: tx.amount,
      newBalance: wallet?.balance ?? 0,
      message: "Transaction already credited",
    });
  }

  if (tx.status !== "pending") {
    return ok({ success: false, status: tx.status, amountAdded: 0, newBalance: 0 });
  }

  if (!config.paystack.secretKey()) {
    return err("Paystack is not configured", 503, "PAYSTACK_NOT_CONFIGURED");
  }

  // Resolve the customer code stored at initiation.
  let metadata: Record<string, any> = {};
  try {
    metadata = tx.metadata ? JSON.parse(tx.metadata) : {};
  } catch {
    metadata = {};
  }
  const customerCode: string | undefined = metadata.customer_code;
  if (!customerCode) {
    return err("Transaction is missing Paystack customer details", 400, "TRANSFER_NOT_VERIFIABLE");
  }

  // Expired virtual account — the user must start a fresh deposit.
  const expiresAt = metadata.expires_at ? new Date(metadata.expires_at).getTime() : null;
  if (expiresAt && Date.now() > expiresAt) {
    return ok({ success: false, status: "expired", amountAdded: 0, newBalance: 0 });
  }

  let transfers;
  try {
    transfers = await listCustomerTransactions(customerCode);
  } catch (error) {
    console.error("[confirm-transfer] Paystack list error:", error);
    return err("Unable to verify transfer with Paystack", 502, "PAYSTACK_VERIFY_FAILED");
  }

  // Find a successful dedicated-NUBAN transfer of the exact amount that has not
  // yet been consumed (its Paystack reference is not already on another row).
  const amountNaira = Number(tx.amount);
  let matchedReference: string | null = null;
  for (const t of transfers) {
    if (
      t.channel === "dedicated_nuban" &&
      t.status === "success" &&
      t.amountNaira === amountNaira &&
      t.reference
    ) {
      const [alreadyUsed] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.paystack_ref, t.reference))
        .limit(1);
      if (!alreadyUsed) {
        matchedReference = t.reference;
        break;
      }
    }
  }

  if (!matchedReference) {
    return ok({
      success: false,
      status: "pending",
      amountAdded: 0,
      newBalance: 0,
      message: "No matching transfer found yet",
    });
  }

  const { credited, newBalance } = await creditDeposit({
    txId: tx.id,
    userId: tx.user_id,
    amountNaira,
    currency: tx.currency,
    paystackReference: matchedReference,
  });

  if (!credited) {
    // Lost a concurrent race — another request already credited it.
    return ok({
      success: true,
      status: "success",
      amountAdded: amountNaira,
      newBalance,
      message: "Transaction already credited",
    });
  }

  return ok({
    success: true,
    status: "success",
    amountAdded: amountNaira,
    newBalance,
    message: "Transfer verified successfully",
  });
}
