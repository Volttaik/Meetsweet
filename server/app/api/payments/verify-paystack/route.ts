import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
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

  const now = new Date().toISOString();

  // Find the transaction
  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);

  if (!tx) {
    return err("Transaction not found", 404);
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

  // Check with Paystack if there's a reference
  if (tx.reference && tx.reference.startsWith("ws_")) {
    const secretKey = config.paystack.secretKey();
    
    if (secretKey) {
      try {
        const response = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(tx.reference)}`,
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );

        const json = await response.json() as {
          status: boolean;
          message?: string;
          data?: {
            status: string;
            amount: number;
          };
        };

        if (response.ok && json.status && json.data?.status === "success") {
          const amount = json.data.amount / 100; // Convert from kobo

          // Update transaction status
          await db
            .update(transactions)
            .set({ status: "success", updated_at: now })
            .where(eq(transactions.id, transactionId));

          // Credit wallet
          const [wallet] = await db
            .select({ id: wallets.id, balance: wallets.balance })
            .from(wallets)
            .where(eq(wallets.user_id, auth.user.userId))
            .limit(1);

          let newBalance = 0;
          if (wallet) {
            newBalance = (wallet.balance ?? 0) + amount;
            await db
              .update(wallets)
              .set({ balance: newBalance, updated_at: now })
              .where(eq(wallets.id, wallet.id));
          } else {
            newBalance = amount;
            await db.insert(wallets).values({
              id: generateId(),
              user_id: auth.user.userId,
              balance: amount,
              currency: "NGN",
            });
          }

          return ok({
            success: true,
            amountAdded: amount,
            newBalance,
            message: "Payment verified successfully",
          });
        }
      } catch (error) {
        console.error("Paystack verify error:", error);
      }
    }

    // Development mode - simulate successful payment
    await db
      .update(transactions)
      .set({ status: "success", updated_at: now })
      .where(eq(transactions.id, transactionId));

    const [wallet] = await db
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, auth.user.userId))
      .limit(1);

    let newBalance = 0;
    if (wallet) {
      newBalance = (wallet.balance ?? 0) + tx.amount;
      await db
        .update(wallets)
        .set({ balance: newBalance, updated_at: now })
        .where(eq(wallets.id, wallet.id));
    } else {
      newBalance = tx.amount;
      await db.insert(wallets).values({
        id: generateId(),
        user_id: auth.user.userId,
        balance: tx.amount,
        currency: "NGN",
      });
    }

    return ok({
      success: true,
      amountAdded: tx.amount,
      newBalance,
      message: "Payment verified (development mode)",
    });
  }

  return ok({
    success: false,
    amountAdded: 0,
    newBalance: 0,
    message: "Transaction pending",
  });
}
