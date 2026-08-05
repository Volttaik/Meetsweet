import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions, creator_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { tierIndex } from "@/lib/services/content";

// subscriber_plus costs 2× the creator's subscription_price
const TIER_MULTIPLIER: Record<string, number> = {
  subscriber:      1,
  subscriber_plus: 2,
};

const schema = z.object({
  tier: z.enum(["subscriber", "subscriber_plus"]),
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

  // Current tier defaults to "subscriber_plus" if not stored (legacy)
  const currentTier = sub.tier ?? "subscriber_plus";

  if (tierIndex(newTier) >= tierIndex(currentTier)) {
    return err(`New tier must be lower than current tier (${currentTier}) for a downgrade`, 400);
  }

  // Resolve creator price for the new amount
  const [settings] = await db
    .select({ subscription_price: creator_settings.subscription_price })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, sub.creator_id))
    .limit(1);
  const creatorPrice = settings?.subscription_price ?? 0;
  const newAmount = Math.round(creatorPrice * (TIER_MULTIPLIER[newTier] ?? 1));

  const now = new Date().toISOString();

  // Downgrade takes effect at end of billing period (expires_at stays the same).
  // We record the new tier + amount now so the next renewal charges the lower price.
  await db
    .update(subscriptions)
    .set({ tier: newTier, amount: newAmount, updated_at: now })
    .where(eq(subscriptions.id, id));

  return ok({
    subscription: {
      id: sub.id,
      creator_id: sub.creator_id,
      tier: newTier,
      status: sub.status,
      amount: newAmount,
      started_at: sub.started_at,
      expires_at: sub.expires_at,
    },
  });
}
