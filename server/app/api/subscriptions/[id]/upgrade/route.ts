import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions, wallets, transactions, creator_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
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
 * POST /api/subscriptions/:id/upgrade
 *
 * Upgrades an existing subscription to a higher tier.
 * Charges the wallet for the price difference.
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

  // Current tier defaults to "subscriber" if not stored (legacy flat subscriptions)
  const currentTier = sub.tier ?? "subscriber";

  if (tierIndex(newTier) <= tierIndex(currentTier)) {
    return err(`New tier must be higher than current tier (${currentTier})`, 400);
  }

  // Resolve creator price for the diff calculation
  const [settings] = await db
    .select({
      subscription_price: creator_settings.subscription_price,
      subscription_plus_price: creator_settings.subscription_plus_price,
    })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, sub.creator_id))
    .limit(1);
  const creatorPrice = settings?.subscription_price ?? 0;

  const currentMultiplier = TIER_MULTIPLIER[currentTier] ?? 1;
  const newMultiplier = TIER_MULTIPLIER[newTier] ?? 1;
  const newPrice = newTier === "subscriber_plus"
    ? Math.round(settings?.subscription_plus_price ?? creatorPrice * newMultiplier)
    : Math.round(creatorPrice);
  const currentPrice = currentTier === "subscriber_plus"
    ? Math.round(settings?.subscription_plus_price ?? creatorPrice * currentMultiplier)
    : Math.round(creatorPrice);
  const priceDiff = Math.max(0, newPrice - currentPrice);
  const now = new Date().toISOString();

  if (priceDiff > 0) {
    const [wallet] = await db
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, auth.user.userId))
      .limit(1);

    if (!wallet || (wallet.balance ?? 0) < priceDiff) {
      return err("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
    }

    await db
      .update(wallets)
      .set({ balance: (wallet.balance ?? 0) - priceDiff, updated_at: now })
      .where(eq(wallets.id, wallet.id));

    await db.insert(transactions).values({
      id: generateId(),
      user_id: auth.user.userId,
      type: "debit",
      amount: priceDiff,
      currency: "NGN",
      status: "success",
      description: `Subscription upgrade: ${currentTier} → ${newTier}`,
    });
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const newAmount = newPrice;
  await db
    .update(subscriptions)
    .set({ tier: newTier, amount: newAmount, updated_at: now, expires_at: expiresAt })
    .where(eq(subscriptions.id, id));

  return ok({
    subscription: {
      id: sub.id,
      creator_id: sub.creator_id,
      tier: newTier,
      status: sub.status,
      amount: newAmount,
      started_at: sub.started_at,
      expires_at: expiresAt,
    },
  });
}
