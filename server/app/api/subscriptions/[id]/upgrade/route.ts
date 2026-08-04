import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions, wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { TIER_ORDER, tierIndex } from "@/lib/services/content";

// Tier prices — must stay in sync with subscriptions/route.ts
// bronze = flat subscription (priced at creator's own subscription_price, not a fixed platform fee)
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

  // Determine current tier: prefer stored tier column; fall back to amount-based inference
  const currentTier = sub.tier ?? (
    TIER_ORDER.find((t) => TIER_PRICES[t] === sub.amount) ??
    (sub.amount >= 3000 ? "diamond" : sub.amount >= 1500 ? "gold" : sub.amount >= 500 ? "silver" : "bronze")
  );

  if (tierIndex(newTier) <= tierIndex(currentTier)) {
    return err(`New tier must be higher than current tier (${currentTier})`, 400);
  }

  const priceDiff = TIER_PRICES[newTier] - (TIER_PRICES[currentTier] ?? 0);
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

  await db
    .update(subscriptions)
    .set({ tier: newTier, amount: TIER_PRICES[newTier], updated_at: now, expires_at: expiresAt })
    .where(eq(subscriptions.id, id));

  return ok({
    subscription: {
      id: sub.id,
      creator_id: sub.creator_id,
      tier: newTier,
      status: sub.status,
      amount: TIER_PRICES[newTier],
      started_at: sub.started_at,
      expires_at: expiresAt,
    },
  });
}
