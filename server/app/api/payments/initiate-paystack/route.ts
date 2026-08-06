import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, users, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { config } from "@/lib/config";
import { generateId } from "@/lib/auth/codes";

/**
 * POST /api/payments/initiate-paystack
 * 
 * Initiates a Paystack payment for wallet top-up.
 * Creates a pending transaction and returns payment details.
 * 
 * Request body:
 * - amount: number (amount in Naira)
 * 
 * Response:
 * - transactionId: string
 * - accountNumber: string (virtual account for bank transfer)
 * - bankName: string
 * - amount: number
 * - reference: string
 * - expiresAt: string (optional, for temporary accounts)
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

  const secretKey = config.paystack.secretKey();
  if (!secretKey) {
    return err("Paystack is not configured", 503, "PAYSTACK_NOT_CONFIGURED");
  }

  const reference = `ws_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const txId = generateId();
  const now = new Date().toISOString();

  // Create pending transaction record
  await db.insert(transactions).values({
    id: txId,
    user_id: auth.user.userId,
    type: "credit",
    amount,
    currency: "NGN",
    status: "pending",
    reference,
    description: "Wallet top-up - pending",
  });

  // Create Paystack virtual account for bank transfer
  const user = auth.user;
  const [userRecord] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.userId))
    .limit(1);

  const customerEmail = userRecord?.email ?? `${user.userId}@meetsweet.app`;

  try {
    // Use Paystack Initialize Transaction — returns an authorization_url (checkout link)
    // that the mobile opens in a WebView/browser to complete payment.
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: customerEmail,
        amount: amount * 100, // convert Naira → kobo
        reference,
        currency: "NGN",
        metadata: {
          user_id: user.userId,
          purpose: "wallet_topup",
        },
      }),
    });

    const json = await response.json() as {
      status: boolean;
      message?: string;
      data?: {
        authorization_url: string;
        access_code: string;
        reference: string;
      };
    };

    if (!response.ok || !json.status || !json.data) {
      console.error("[initiate-paystack] Paystack error:", json.message);
      await db
        .update(transactions)
        .set({ status: "failed", updated_at: new Date().toISOString() })
        .where(eq(transactions.id, txId));
      return err(json.message ?? "Failed to initialize payment", 502);
    }

    return ok({
      transactionId: txId,
      transaction_id: txId,
      reference: json.data.reference,
      authorization_url: json.data.authorization_url,
      access_code: json.data.access_code,
      // Hosted checkout is the live Paystack flow. The mobile client should
      // open this URL; initialize does not create a virtual bank account.
      authorizationUrl: json.data.authorization_url,
      amount,
    });
  } catch (error) {
    console.error("Paystack initiate error:", error);
    await db
      .update(transactions)
      .set({ status: "failed", updated_at: new Date().toISOString() })
      .where(eq(transactions.id, txId));
    return err("Payment initiation failed", 502);
  }
}
