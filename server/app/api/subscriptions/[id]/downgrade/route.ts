import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { TIER_ORDER, tierIndex } from "@/lib/services/content";

// Tier prices — must stay in sync with subscriptions/route.ts
const TIER_PRICES: Record<string, number> = {
  bronze:  0,
  silver:  500,
  gold:    1500,
  diamond: 3000,
};

const schema = z.object({
  tier: z.enum(["bronze", "silver", "gold", "diamond"]),
});

/**
 * POST /api/subscriptions/:id/downgrade
 *
 * Schedules a subscription downgrade to a lower tier.
 * Takes effect at the end of the current billing period.
 * No refund is issued for unused time.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const { tier: newTier } = parsed.data;

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, id),
        eq(subscriptions.subscriber_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!sub) return err("Subscription not found", 404);
  if (sub.status !== "active") return err("Subscription is not active", 400);

  // Determine current tier: prefer stored tier column; fall back to amount-based inference
  const currentTier = sub.tier ?? (
    TIER_ORDER.find((t) => TIER_PRICES[t] === sub.amount) ??
    (sub.amount >= 3000 ? "diamond" : sub.amount >= 1500 ? "gold" : sub.amount >= 500 ? "silver" : "bronze")
  );

  if (tierIndex(newTier) >= tierIndex(currentTier)) {
    return err(`New tier must be lower than current tier (${currentTier}) for a downgrade`, 400);
  }

  const now = new Date().toISOString();

  // Downgrade takes effect at end of billing period (expires_at stays the same).
  // We record the new tier + amount now so the next renewal charges the lower price.
  await db
    .update(subscriptions)
    .set({ tier: newTier, amount: TIER_PRICES[newTier], updated_at: now })
    .where(eq(subscriptions.id, id));

  return ok({
    subscription: {
      id: sub.id,
      creator_id: sub.creator_id,
      tier: newTier,
      status: sub.status,
      amount: TIER_PRICES[newTier],
      started_at: sub.started_at,
      expires_at: sub.expires_at,
    },
  });
}
