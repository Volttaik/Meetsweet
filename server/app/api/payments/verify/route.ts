import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { config } from "@/lib/config";
import { generateId } from "@/lib/auth/codes";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const reference = req.nextUrl.searchParams.get("reference");
  if (!reference) return err("reference query parameter is required", 400);

  const secretKey = config.paystack.secretKey();
  if (!secretKey) {
    // Paystack not configured — return a stub for development
    return ok({
      status: "success",
      transaction: {
        id: generateId(),
        type: "credit",
        amount: 0,
        description: "Payment verified (Paystack not configured)",
        status: "success",
        created_at: new Date().toISOString(),
      },
    });
  }

  // Verify with Paystack
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  const json = (await response.json()) as {
    status: boolean;
    message: string;
    data?: {
      status: string;
      amount: number;
      currency: string;
      reference: string;
      customer: { email: string };
      paid_at: string;
    };
  };

  if (!response.ok || !json.status || !json.data) {
    return err(json.message ?? "Payment verification failed", 502);
  }

  const ps = json.data;
  const succeeded = ps.status === "success";
  const amountNGN = ps.amount / 100; // Paystack uses kobo

  // Upsert a transaction record
  const [existingTx] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.reference, reference))
    .limit(1);

  let txId: string;
  const now = new Date().toISOString();

  if (existingTx) {
    txId = existingTx.id;
    await db
      .update(transactions)
      .set({ status: succeeded ? "success" : "failed", updated_at: now })
      .where(eq(transactions.id, txId));
  } else {
    txId = generateId();
    await db.insert(transactions).values({
      id: txId,
      user_id: auth.user.userId,
      type: "credit",
      amount: amountNGN,
      currency: ps.currency ?? "NGN",
      status: succeeded ? "success" : "failed",
      reference,
      paystack_ref: reference,
      description: "Wallet top-up via Paystack",
    });
  }

  // Credit wallet if payment succeeded and not already credited
  if (succeeded && !existingTx) {
    const [wallet] = await db
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, auth.user.userId))
      .limit(1);

    if (wallet) {
      await db
        .update(wallets)
        .set({ balance: (wallet.balance ?? 0) + amountNGN, updated_at: now })
        .where(eq(wallets.id, wallet.id));
    } else {
      await db.insert(wallets).values({
        id: generateId(),
        user_id: auth.user.userId,
        balance: amountNGN,
        currency: ps.currency ?? "NGN",
      });
    }
  }

  return ok({
    status: succeeded ? "success" : "failed",
    transaction: {
      id: txId,
      type: "credit",
      amount: amountNGN,
      description: "Wallet top-up via Paystack",
      status: succeeded ? "success" : "failed",
      created_at: now,
    },
  });
}
