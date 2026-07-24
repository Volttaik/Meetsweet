import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, wallets } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseQuery } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { z } from "zod";

const schema = z.object({ reference: z.string().min(1) });

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = parseQuery(req.nextUrl.searchParams, schema);
  if (!parsed.success) return parsed.response;
  const { reference } = parsed.data;

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new Error("PAYSTACK_SECRET_KEY is required");

  const [txn] = await db.select().from(transactions).where(eq(transactions.reference, reference)).limit(1);
  if (!txn) return err("Transaction not found", 404);
  if (txn.user_id !== auth.user.userId) return err("Forbidden", 403);
  if (txn.status === "success") return ok({ status: "success", transaction: txn });

  const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  const data = await res.json();
  if (!data.status || data.data.status !== "success") {
    return ok({ status: data.data?.status ?? "failed", transaction: txn });
  }

  // Credit wallet on success
  await db.update(transactions).set({ status: "success", paystack_ref: data.data.id?.toString() }).where(eq(transactions.id, txn.id));

  const [wallet] = await db.select().from(wallets).where(eq(wallets.user_id, auth.user.userId)).limit(1);
  if (wallet) {
    await db.update(wallets).set({ balance: wallet.balance + txn.amount }).where(eq(wallets.id, wallet.id));
  }

  return ok({ status: "success", transaction: txn });
}
