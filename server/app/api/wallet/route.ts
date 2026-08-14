import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  let [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const txRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.user_id, auth.user.userId))
    .orderBy(desc(transactions.created_at))
    .limit(50);

  const history = txRows.map((t) => ({
    id: t.id,
    type: t.type,
    amount: t.amount,
    description: t.description ?? "Wallet transaction",
    status: t.status,
    createdAt: t.created_at,
  }));

  // Mobile expects { balance, currency, transactions } at the top level of data.
  const w = wallet ?? { balance: 0, currency: "NGN" };
  return ok({ balance: w.balance, currency: w.currency, transactions: history });
}
