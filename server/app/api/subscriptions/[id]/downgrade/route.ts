import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const TIER_PRICES: Record<string, number> = {
  free: 0,
  normal: 200,
  premium: 500,
  vip: 1000,
};

const TIER_ORDER = ["free", "normal", "premium", "vip"];

const schema = z.object({
  tier: z.enum(["free", "normal", "premium", "vip"]),
});

/**
 * POST /api/subscriptions/:id/downgrade
 *
 * Schedules a subscription downgrade to a lower tier.
 * Takes effect at the end of the current billing period.
 * No refund is issued for unused time.
 *
 * Request body:
 * - tier: "free" | "normal" | "premium" | "vip"
 *
 * Response:
 * - subscription: { id, creator_id, tier, status, amount, started_at, expires_at }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const parsed = await parseBody(req, schema);
  if ("response" in parsed) return parsed.response;

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

  if (!sub) {
    return err("Subscription not found", 404);
  }

  const currentTierIndex = TIER_ORDER.indexOf(
    sub.amount > 500 ? "vip"
    : sub.amount > 200 ? "premium"
    : sub.amount > 0 ? "normal"
    : "free",
  );
  const newTierIndex = TIER_ORDER.indexOf(newTier);

  if (newTierIndex >= currentTierIndex) {
    return err("New tier must be lower than current tier for downgrade", 400);
  }

  const now = new Date().toISOString();

  // Downgrade takes effect at end of billing period (expires_at stays the same).
  // We record the new amount now so the next renewal charges the lower price.
  await db
    .update(subscriptions)
    .set({ amount: TIER_PRICES[newTier], updated_at: now })
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
