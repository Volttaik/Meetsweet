import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, notFound } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  if (!wallet) return notFound("Wallet not found");

  const history = await db
    .select()
    .from(transactions)
    .where(eq(transactions.user_id, auth.user.userId))
    .orderBy(desc(transactions.created_at))
    .limit(50);

  return ok({ wallet, transactions: history });
}
