import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions, creator_settings, wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

// Tier price mapping
const TIER_PRICES: Record<string, number> = {
  free: 0,
  normal: 200,
  premium: 500,
  vip: 1000,
};

const upgradeSchema = z.object({
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
  const parsed = await parseBody(req, upgradeSchema);
  if (!parsed.success) return parsed.response;

  const newTier = parsed.data.tier;
  const newPrice = TIER_PRICES[newTier] ?? 0;

  // Get current subscription amount (derive tier from amount)
  const currentAmount = subscription.amount ?? 0;
  const currentTierPrice = Object.values(TIER_PRICES).find(p => p === currentAmount) ?? currentAmount;
  const priceDifference = newPrice - currentAmount;

  if (priceDifference <= 0) {
    return err("Cannot upgrade to a lower or equal tier", 400);
  }

  // Get creator's subscription price
  const [settings] = await db
    .select({ subscription_price: creator_settings.subscription_price })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, subscription.creator_id))
    .limit(1);

  // Calculate actual upgrade price (difference from creator's base price)
  const creatorBasePrice = settings?.subscription_price ?? 0;
  const upgradeCost = Math.max(0, priceDifference);

  // Check wallet balance
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const balance = wallet?.balance ?? 0;
  if (balance < upgradeCost) {
    return err("Insufficient wallet balance", 400);
  }

  // Process upgrade
  const now = new Date().toISOString();

  // Deduct from wallet
  await db
    .update(wallets)
    .set({ balance: balance - upgradeCost, updated_at: now })
    .where(eq(wallets.user_id, auth.user.userId));

  // Credit creator's wallet
  const [creatorWallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.user_id, subscription.creator_id))
    .limit(1);

  if (creatorWallet) {
    await db
      .update(wallets)
      .set({
        balance: (creatorWallet.balance ?? 0) + upgradeCost,
        updated_at: now,
      })
      .where(eq(wallets.user_id, subscription.creator_id));
  }

  // Create transaction record
  await db.insert(transactions).values({
    id: generateId(),
    user_id: auth.user.userId,
    type: "subscription_upgrade",
    amount: -upgradeCost,
    status: "completed",
    description: `Upgrade subscription to ${newTier}`,
    metadata: JSON.stringify({
      subscription_id: subscriptionId,
      creator_id: subscription.creator_id,
      old_tier: "normal",
      new_tier: newTier,
      amount_paid: upgradeCost,
    }),
  });

  // Update subscription
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .update(subscriptions)
    .set({
      amount: newPrice,
      expires_at: expiresAt,
      status: "active",
      updated_at: now,
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
