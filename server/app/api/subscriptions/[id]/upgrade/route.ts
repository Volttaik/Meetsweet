import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptions, wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

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
 * POST /api/subscriptions/:id/upgrade
 *
 * Upgrades an existing subscription to a higher tier.
 * Charges the wallet for the tier difference.
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

  const currentTierIndex = TIER_ORDER.indexOf(sub.amount > 500 ? "vip" : sub.amount > 200 ? "premium" : sub.amount > 0 ? "normal" : "free");
  const newTierIndex = TIER_ORDER.indexOf(newTier);

  if (newTierIndex <= currentTierIndex) {
    return err("New tier must be higher than current tier", 400);
  }

  const priceDiff = TIER_PRICES[newTier] - (TIER_PRICES[TIER_ORDER[currentTierIndex]] ?? 0);
  const now = new Date().toISOString();

  // Charge wallet for the difference
  if (priceDiff > 0) {
    const [wallet] = await db
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, auth.user.userId))
      .limit(1);

    if (!wallet || (wallet.balance ?? 0) < priceDiff) {
      return err("Insufficient wallet balance", 400);
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
      description: `Subscription upgrade to ${newTier}`,
    });
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db
    .update(subscriptions)
    .set({ amount: TIER_PRICES[newTier], updated_at: now, expires_at: expiresAt })
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
