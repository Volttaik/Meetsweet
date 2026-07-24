import { lt, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";

export interface ExpireSubscriptionsResult {
  expired: number;
}

/**
 * Mark active subscriptions as expired when their `expires_at` is in the past.
 */
export async function expireSubscriptions(): Promise<ExpireSubscriptionsResult> {
  const now = new Date().toISOString();

  const result = await db
    .update(subscriptions)
    .set({ status: "expired", updated_at: now })
    .where(
      and(eq(subscriptions.status, "active"), lt(subscriptions.expires_at, now))
    )
    .returning({ id: subscriptions.id });

  return { expired: result.length };
}
