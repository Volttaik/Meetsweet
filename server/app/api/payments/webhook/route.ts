import { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, wallets } from "@/lib/db/schema";
import { ok, err } from "@/lib/api/response";

export async function POST(req: NextRequest) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return err("Server misconfiguration", 500);

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const hash = createHmac("sha512", secretKey).update(rawBody).digest("hex");

  if (hash !== signature) return err("Invalid signature", 401);

  const event = JSON.parse(rawBody);
  if (event.event !== "charge.success") return ok(null);

  const { reference, amount, metadata } = event.data;
  const amountNaira = amount / 100;

  const [txn] = await db.select().from(transactions).where(eq(transactions.reference, reference)).limit(1);
  if (!txn || txn.status === "success") return ok(null);

  await db.update(transactions).set({ status: "success" }).where(eq(transactions.id, txn.id));

  const [wallet] = await db.select().from(wallets).where(eq(wallets.user_id, txn.user_id)).limit(1);
  if (wallet) {
    await db.update(wallets).set({ balance: wallet.balance + amountNaira }).where(eq(wallets.id, wallet.id));
  }

  return ok(null);
}
