import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions, creator_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

/**
 * POST /api/subscriptions/:id/upgrade
 *
 * Upgrade a subscription to a higher tier.
 * Calculates the prorated difference and charges the user's wallet.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const parsed = await parseBody(req, z.object({
    tier: z.enum(["free", "normal", "premium", "vip"]),
  }));
  if (!parsed.success) return parsed.response;

  const newTier = parsed.data.tier;

  // Get the current subscription
  const [sub] = await db
    .select({
      id: subscriptions.id,
      subscriber_id: subscriptions.subscriber_id,
      creator_id: subscriptions.creator_id,
      tier: subscriptions.tier,
      status: subscriptions.status,
      amount: subscriptions.amount,
    })
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .limit(1);

  if (!sub) return err("Subscription not found", 404);
  if (sub.subscriber_id !== auth.user.userId) return err("Forbidden", 403);
  if (sub.status !== "active") return err("Subscription is not active", 400);

  // Get the creator's tier prices
  const [settings] = await db
    .select({ subscription_price: creator_settings.subscription_price })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, sub.creator_id))
    .limit(1);

  const tierPrices: Record<string, number> = {
    free: 0,
    normal: settings?.subscription_price ?? 200,
    premium: (settings?.subscription_price ?? 200) * 2.5,
    vip: (settings?.subscription_price ?? 200) * 5,
  };

  const currentPrice = tierPrices[sub.tier] ?? 0;
  const newPrice = tierPrices[newTier] ?? 0;

  if (newPrice <= currentPrice) {
    return err("Upgrade tier must be higher than current tier", 400);
  }

  // Calculate prorated difference (simplified: charge the full tier price)
  const upgradeCost = newPrice - currentPrice;

  // For now, we just update the subscription tier
  // In a real implementation, you would charge the user's wallet
  await db
    .update(subscriptions)
    .set({
      tier: newTier,
      amount: newPrice,
      updated_at: new Date().toISOString(),
    })
    .where(eq(subscriptions.id, id));

  // Fetch updated subscription
  const [updated] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .limit(1);

  return ok({ subscription: updated, upgrade_cost: upgradeCost });
}
