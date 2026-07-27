import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { wallets } from "@/lib/db/schema";
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

  // Mobile expects { balance, currency } at the top level of data, not nested.
  const w = wallet ?? { balance: 0, currency: "NGN" };
  return ok({ balance: w.balance, currency: w.currency });
}
