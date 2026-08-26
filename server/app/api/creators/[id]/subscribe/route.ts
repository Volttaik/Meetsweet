import { NextRequest } from "next/server";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  creator_settings,
  profiles,
  subscriptions,
  transactions,
  users,
  wallets,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { notifySubscription } from "@/lib/services/notifications";
import { tierIndex } from "@/lib/services/content";
import { resolveBasePrice } from "@/lib/services/pricing";
import { recordCreatorEarning } from "@/lib/services/creator-finance";

const TIER_MULTIPLIER: Record<string, number> = { subscriber: 1, subscriber_plus: 2 };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id: creator_id } = await params;
  if (creator_id === auth.user.userId) return err("Cannot subscribe to yourself", 400);

  const parsed = await parseBody(
    req,
    z.object({ plan: z.enum(["subscriber", "subscriber_plus"]).optional() }),
  );
  if (!parsed.success) return parsed.response;

  const tier: "subscriber" | "subscriber_plus" = parsed.data.plan ?? "subscriber";

  const [creator] = await db
    .select({ id: users.id, is_creator: users.is_creator })
    .from(users)
    .where(eq(users.id, creator_id))
    .limit(1);
  // Subscription functionality is creator-only. A non-creator account can
  // never be a subscription target — enforced server-side.
  if (!creator) return err("Creator not found", 404);
  if (!creator.is_creator) return err("This account cannot be subscribed to", 400);

  const [settings] = await db
    .select({
      subscription_price: creator_settings.subscription_price,
      subscription_plus_price: creator_settings.subscription_plus_price,
    })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, creator_id))
    .limit(1);

  // Legacy creators may only have profiles.subscription_price (no creator_settings
  // row). Fall back to it so the charge always matches the price the profile
  // endpoint advertises — never a silent ₦0 for a priced creator.
  const [profile] = await db
    .select({ subscription_price: profiles.subscription_price })
    .from(profiles)
    .where(eq(profiles.user_id, creator_id))
    .limit(1);

  const basePrice = resolveBasePrice(settings?.subscription_price, profile?.subscription_price);
  const plusPrice = Math.round(settings?.subscription_plus_price ?? basePrice * TIER_MULTIPLIER.subscriber_plus);
  const price = tier === "subscriber_plus" ? plusPrice : Math.round(basePrice);

  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const subId = generateId();

  // The wallet debit + transaction + subscription insert are ONE atomic unit.
  // A failure at any step rolls the whole thing back so the user is never
  // charged without receiving an active subscription (or vice-versa).
  type Outcome = { kind: "existing" | "created" | "upgraded"; id: string; tier: "subscriber" | "subscriber_plus" };
  let outcome!: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      // Idempotency: one active subscription per (subscriber, creator).
      const [existing] = await tx
        .select({ id: subscriptions.id, tier: subscriptions.tier })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.subscriber_id, auth.user.userId),
            eq(subscriptions.creator_id, creator_id),
            eq(subscriptions.status, "active"),
          ),
        )
        .limit(1);
      if (existing) {
        const existingTier = (existing.tier ?? "subscriber") as "subscriber" | "subscriber_plus";
        // Re-subscribing at the same (or lower) tier is idempotent — return the
        // existing subscription without a second charge.
        if (tierIndex(tier) <= tierIndex(existingTier)) {
          return { kind: "existing", id: existing.id, tier: existingTier };
        }

        // Upgrade to a higher tier: charge only the price difference, then bump
        // the tier. Atomic with the debit so a failed payment never activates
        // the upgrade (and a successful one always does).
        const currentPrice = existingTier === "subscriber_plus" ? plusPrice : Math.round(basePrice);
        const newPrice = tier === "subscriber_plus" ? plusPrice : Math.round(basePrice);
        const priceDiff = Math.max(0, newPrice - currentPrice);

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
            type: "subscription",
            amount: priceDiff,
            currency: "NGN",
            status: "success",
            description: `Subscription upgrade ${existingTier} → ${tier} (${creator_id})`,
            metadata: JSON.stringify({ creator_id, tier, from_tier: existingTier }),
          });

          await recordCreatorEarning(tx, {
            creatorId: creator_id,
            buyerId: auth.user.userId,
            sourceType: "subscription",
            sourceId: existing.id,
            grossAmount: priceDiff,
            description: `Subscription upgrade from a fan (${auth.user.userId})`,
            metadata: { subscriber_id: auth.user.userId, tier, from_tier: existingTier },
          });
        }

        await tx
          .update(subscriptions)
          .set({ tier, amount: newPrice, updated_at: now, expires_at: expires })
          .where(eq(subscriptions.id, existing.id));

        return { kind: "upgraded", id: existing.id, tier };
      }

      if (price > 0) {
        const [wallet] = await tx
          .select({ id: wallets.id, balance: wallets.balance })
          .from(wallets)
          .where(eq(wallets.user_id, auth.user.userId))
          .limit(1);
        if (!wallet || (wallet.balance ?? 0) < price) {
          throw new Error("INSUFFICIENT_BALANCE");
        }

        // Conditional debit: only succeeds if the balance is still sufficient,
        // preventing concurrent double-charges.
        const [debited] = await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} - ${price}`, updated_at: now })
          .where(and(eq(wallets.id, wallet.id), gte(wallets.balance, price)))
          .returning({ id: wallets.id });
        if (!debited) throw new Error("INSUFFICIENT_BALANCE");

        await tx.insert(transactions).values({
          id: generateId(),
          user_id: auth.user.userId,
          type: "subscription",
          amount: price,
          currency: "NGN",
          status: "success",
          description: `Subscription to creator ${creator_id}`,
          metadata: JSON.stringify({ creator_id, tier }),
        });

        await recordCreatorEarning(tx, {
          creatorId: creator_id,
          buyerId: auth.user.userId,
          sourceType: "subscription",
          sourceId: subId,
          grossAmount: price,
          description: `Subscription from a fan (${auth.user.userId})`,
          metadata: { subscriber_id: auth.user.userId, tier },
        });
      }

      await tx.insert(subscriptions).values({
        id: subId,
        subscriber_id: auth.user.userId,
        creator_id,
        status: "active",
        tier,
        amount: price,
        started_at: now,
        expires_at: expires,
      });

      return { kind: "created", id: subId, tier };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      return err("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
    }
    throw error;
  }

  // Authoritative subscriber count AFTER the transaction so the client can
  // update the creator profile immediately (no stale zero-count after subscribe).
  const [subCountRow] = await db
    .select({ n: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.creator_id, creator_id), eq(subscriptions.status, "active")));
  const subscriber_count = subCountRow?.n ?? 0;
  const [walletRow] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);
  const balance = walletRow?.balance ?? 0;

  if (outcome.kind === "existing") {
    return ok({
      subscription_id: outcome.id,
      subscribed: true,
      tier: outcome.tier,
      subscriber_count,
      subscriberCount: subscriber_count,
      subscription: { id: outcome.id, creator_id, status: "active" },
    });
  }

  if (outcome.kind === "upgraded") {
    return ok({
      subscription_id: outcome.id,
      subscribed: true,
      tier: outcome.tier,
      upgraded: true,
      subscriber_count,
      subscriberCount: subscriber_count,
      subscription: { id: outcome.id, creator_id, status: "active" },
    });
  }

  // Best-effort notification + push — outside the transaction so a delivery
  // failure can never roll back the committed subscription. The service gates
  // the row + push by the creator's New Subscribers preference and dedupes so
  // a retried subscribe never double-notifies.
  void notifySubscription({ actorId: auth.user.userId, creatorId: creator_id });

  return created({
    subscribed: true,
    subscription_id: subId,
    tier,
    subscriber_count,
    subscriberCount: subscriber_count,
    subscription: { id: subId, creator_id, status: "active", amount: price, started_at: now, expires_at: expires },
  });
}
