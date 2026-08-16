import { NextRequest } from "next/server";
import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions, wallets, transactions, creator_settings, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { tierIndex } from "@/lib/services/content";
import { resolveBasePrice } from "@/lib/services/pricing";

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

  // Resolve creator price for the diff calculation from the same authoritative
  // sources as /creators/[id]/subscribe (never a silent ₦0 for a priced creator).
  const [settings] = await db
    .select({
      subscription_price: creator_settings.subscription_price,
      subscription_plus_price: creator_settings.subscription_plus_price,
    })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, sub.creator_id))
    .limit(1);
  const [profile] = await db
    .select({ subscription_price: profiles.subscription_price })
    .from(profiles)
    .where(eq(profiles.user_id, sub.creator_id))
    .limit(1);
  const creatorPrice = resolveBasePrice(settings?.subscription_price, profile?.subscription_price);

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
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const newAmount = newPrice;

  // Atomic debit + transaction + tier update — a failure at any step rolls back
  // the entire upgrade so the user is never charged without the tier change.
  try {
    await db.transaction(async (tx) => {
      if (priceDiff > 0) {
        const [wallet] = await tx
          .select({ id: wallets.id, balance: wallets.balance })
          .from(wallets)
          .where(eq(wallets.user_id, auth.user.userId))
          .limit(1);

        if (!wallet || (wallet.balance ?? 0) < priceDiff) {
          throw new Error("INSUFFICIENT_BALANCE");
        }

        const [debited] = await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} - ${priceDiff}`, updated_at: now })
          .where(and(eq(wallets.id, wallet.id), gte(wallets.balance, priceDiff)))
          .returning({ id: wallets.id });
        if (!debited) throw new Error("INSUFFICIENT_BALANCE");

        await tx.insert(transactions).values({
          id: generateId(),
          user_id: auth.user.userId,
          type: "debit",
          amount: priceDiff,
          currency: "NGN",
          status: "success",
          description: `Subscription upgrade: ${currentTier} → ${newTier}`,
        });
      }

      await tx
        .update(subscriptions)
        .set({ tier: newTier, amount: newAmount, updated_at: now, expires_at: expiresAt })
        .where(eq(subscriptions.id, id));
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      return err("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
    }
    throw error;
  }

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
