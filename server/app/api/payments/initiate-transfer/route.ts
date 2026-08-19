import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { config } from "@/lib/config";
import { generateId } from "@/lib/auth/codes";
import { ensureCustomer, assignDedicatedAccount } from "@/lib/services/paystack";

/**
 * POST /api/payments/initiate-transfer
 *
 * Starts an in-app wallet top-up via Paystack bank transfer (Dedicated Virtual
 * Account). Unlike the legacy hosted checkout, no authorization_url is returned
 * and the user never leaves the app — they transfer the exact amount to the
 * virtual account and then confirm.
 *
 * Body: { amount: number }  (Naira)
 *
 * Response:
 * - transactionId: string
 * - accountNumber: string  (virtual NUBAN to transfer into)
 * - accountName:   string  (account holder name to use)
 * - bankName:      string  (issuing bank)
 * - amount:        number  (exact amount to transfer)
 * - expiresAt:     string | null
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  let body: { amount?: number };
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  const amount = body?.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return err("amount is required and must be positive", 400);
  }

  if (!config.paystack.secretKey()) {
    return err("Paystack is not configured", 503, "PAYSTACK_NOT_CONFIGURED");
  }

  const [userRecord] = await db
    .select()
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  const email = userRecord?.email ?? `${auth.user.userId}@meetsweet.app`;
  const fullName = (userRecord?.full_name ?? "").trim() || email.split("@")[0];
  const [firstName, ...rest] = fullName.split(/\s+/);
  const lastName = rest.join(" ").trim() || "MeetSweet";

  try {
    // 1. Stable Paystack customer (idempotent by email).
    const customerCode = await ensureCustomer({
      email,
      firstName: firstName || "MeetSweet",
      lastName,
    });

    // 2. Temporary dedicated virtual account bound to this exact amount.
    const acct = await assignDedicatedAccount({
      customerCode,
      amountNaira: amount,
      firstName: firstName || "MeetSweet",
      lastName,
    });

    // 3. Record a pending deposit. The customer code lives in metadata so the
    //    webhook / confirm step can match the incoming transfer back to us.
    const txId = generateId();
    const reference = `tfr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    await db.insert(transactions).values({
      id: txId,
      user_id: auth.user.userId,
      type: "credit",
      amount,
      currency: "NGN",
      status: "pending",
      reference,
      description: "Wallet top-up - bank transfer",
      metadata: JSON.stringify({
        customer_code: acct.customerCode,
        account_number: acct.accountNumber,
        account_name: acct.accountName,
        bank_name: acct.bankName,
        expires_at: acct.expiresAt,
        created_at: now,
      }),
    });

    return ok({
      transactionId: txId,
      transaction_id: txId,
      reference,
      accountNumber: acct.accountNumber,
      accountName: acct.accountName,
      bankName: acct.bankName,
      amount,
      expiresAt: acct.expiresAt ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create bank transfer account";
    console.error("[initiate-transfer] Paystack dedicated account error:", message);

    // DVA is a separate Paystack product. If it is not enabled for this account
    // the assign call rejects — surface that clearly instead of silently
    // falling back to a hosted checkout the client no longer opens.
    return err(
      "Bank transfer funding is unavailable. Paystack Dedicated Virtual Accounts may not be enabled for this account.",
      502,
      "PAYSTACK_DVA_UNAVAILABLE",
    );
  }
}
