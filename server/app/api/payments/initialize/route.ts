import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, users, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { z } from "zod";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({
  amount: z.number().positive(),
  currency: z.string().default("NGN"),
  type: z.enum(["wallet_topup", "subscription", "purchase"]),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;
  const { amount, currency, type, metadata } = parsed.data;

  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, auth.user.userId)).limit(1);
  if (!user) return err("User not found", 404);

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new Error("PAYSTACK_SECRET_KEY is required");

  const reference = `ms_${generateId().replace(/-/g, "").slice(0, 20)}`;

  // Create pending transaction record
  await db.insert(transactions).values({
    id: generateId(),
    user_id: auth.user.userId,
    type: "credit",
    amount,
    currency,
    status: "pending",
    reference,
    description: type,
    metadata: JSON.stringify(metadata ?? {}),
  });

  // Initialize Paystack transaction
  const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: user.email,
      amount: Math.round(amount * 100), // kobo
      currency,
      reference,
      metadata: { user_id: auth.user.userId, type, ...(metadata ?? {}) },
    }),
  });

  const data = await paystackRes.json();
  if (!data.status) return err(data.message ?? "Payment initialization failed", 400);

  return ok({
    authorization_url: data.data.authorization_url,
    access_code: data.data.access_code,
    reference,
  });
}
