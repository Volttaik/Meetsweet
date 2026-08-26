import { NextRequest } from "next/server";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { renewForUser } from "@/lib/services/subscription-renewal";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Lazy renewal: settle any expired subscriptions before returning the
  // balance so it reflects automatic renewal debits (offline-safe re-sync).
  await renewForUser(auth.user.userId);

  let [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const txRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, auth.user.userId),
        // Subscriptions are content payments, not wallet funding — they do not
        // belong in Recent Transactions. Creator EARNINGS are recorded as
        // `<source>_earn` rows (money added to the wallet) and stay visible.
        sql`${transactions.type} != 'subscription'`,
      ),
    )
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
