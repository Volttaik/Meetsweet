import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, wallets, users } from "@/lib/db/schema";
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
  if (!amount || amount <= 0) {
    return err("amount is required and must be positive", 400);
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

  const secretKey = config.paystack.secretKey();
  
  if (!secretKey) {
    // Development mode - return mock payment details
    return ok({
      transactionId: txId,
      transaction_id: txId,
      accountNumber: "8099999999",
      account_number: "8099999999",
      bankName: "Wema Bank",
      bank_name: "Wema Bank",
      amount,
      reference,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  // Create Paystack virtual account for bank transfer
  const user = auth.user;
  const [userRecord] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, user.userId))
    .limit(1);

  const customerEmail = userRecord?.email ?? `${user.userId}@meetsweet.app`;

  try {
    const response = await fetch("https://api.paystack.co/dedicated_account", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer: customerEmail,
        preferred_bank: "wema-bank",
        amount: amount * 100, // Convert to kobo
        reference,
        currency: "NGN",
      }),
    });

    const json = await response.json() as {
      status: boolean;
      message?: string;
      data?: {
        dedicated_account_number?: string;
        bank_name?: string;
        account_number?: string;
        bank?: { name?: string };
        customer?: { email?: string };
        next_action?: { type?: string };
      };
    };

    if (!response.ok || !json.status || !json.data) {
      return err(json.message ?? "Failed to create payment account", 502);
    }

    const accountData = json.data;
    return ok({
      transactionId: txId,
      transaction_id: txId,
      accountNumber: accountData.account_number ?? accountData.dedicated_account_number ?? "",
      account_number: accountData.account_number ?? accountData.dedicated_account_number ?? "",
      bankName: accountData.bank?.name ?? accountData.bank_name ?? "Paystack Bank",
      bank_name: accountData.bank?.name ?? accountData.bank_name ?? "Paystack Bank",
      amount,
      reference,
    });
  } catch (error) {
    console.error("Paystack initiate error:", error);
    return err("Payment initiation failed", 502);
  }
}
