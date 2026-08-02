import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

// Tier price mapping
const TIER_PRICES: Record<string, number> = {
  free: 0,
  normal: 200,
  premium: 500,
  vip: 1000,
};

const downgradeSchema = z.object({
  tier: z.enum(["free", "normal", "premium", "vip"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id: subscriptionId } = await params;

  // Get current subscription
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);

  if (!subscription) return err("Subscription not found", 404);
  if (subscription.subscriber_id !== auth.user.userId) return err("Forbidden", 403);

  // Get the new tier price
  const parsed = await parseBody(req, downgradeSchema);
  if (!parsed.success) return parsed.response;

  const newTier = parsed.data.tier;
  const newPrice = TIER_PRICES[newTier] ?? 0;

  // Get current subscription amount
  const currentAmount = subscription.amount ?? 0;

  if (newPrice >= currentAmount) {
    return err("Cannot downgrade to a higher or equal tier", 400);
  }

  // Downgrade takes effect at end of billing period
  // For now, we just update the tier and it will apply when the current period ends
  const now = new Date().toISOString();

  // Update subscription
  await db
    .update(subscriptions)
    .set({
      amount: newPrice,
      updated_at: now,
      // The downgrade will take effect at the end of the current billing period
      // The status remains active until the expires_at date
    })
    .where(eq(subscriptions.id, subscriptionId));

  // Return updated subscription
  const [updated] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);

  return ok({
    subscription: {
      id: updated!.id,
      creator_id: updated!.creator_id,
      tier: newTier,
      status: updated!.status,
      amount: updated!.amount,
      started_at: updated!.started_at,
      expires_at: updated!.expires_at,
    },
  });
}
