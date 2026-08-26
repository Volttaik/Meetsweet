import { NextRequest } from "next/server";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, subscriptions, creator_settings, wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { sendPushToUser, getActorUsername, createNotification } from "@/lib/services/push";
import { resolveBasePrice } from "@/lib/services/pricing";
import { recordCreatorEarning } from "@/lib/services/creator-finance";
import { renewForUser } from "@/lib/services/subscription-renewal";

// Subscription tier pricing:
//   subscriber      → creator's own subscription_price
//   subscriber_plus → creator's subscription_price × 2  (exclusive / most premium tier)
// Actual price is always computed from the creator's settings, not a platform fixed rate.
const TIER_MULTIPLIER: Record<string, number> = {
  subscriber:      1,
  subscriber_plus: 2,
};

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const type = req.nextUrl.searchParams.get("type") ?? "subscribed"; // subscribed | subscribers

  // Lazy renewal: if any of the viewer's subscriptions expired while they were
  // offline, re-sync them now so the list reflects live renewal state (an
  // expired one either renewed or was cancelled + the user notified).
  await renewForUser(auth.user.userId);

  if (type === "subscribers") {
    const rows = await db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        tier: subscriptions.tier,
        amount: subscriptions.amount,
        currency: subscriptions.currency,
        started_at: subscriptions.started_at,
        expires_at: subscriptions.expires_at,
        created_at: subscriptions.created_at,
        subscriber_id: users.id,
        subscriber_name: users.full_name,
        subscriber_username: users.username,
        subscriber_avatar: profiles.avatar_url,
      })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.subscriber_id))
      .leftJoin(profiles, eq(profiles.user_id, subscriptions.subscriber_id))
      .where(eq(subscriptions.creator_id, auth.user.userId))
      .orderBy(desc(subscriptions.created_at));

    return ok({ subscriptions: rows });
  }

  const rows = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      tier: subscriptions.tier,
      amount: subscriptions.amount,
      currency: subscriptions.currency,
      started_at: subscriptions.started_at,
      expires_at: subscriptions.expires_at,
      created_at: subscriptions.created_at,
      creator_id: users.id,
      creator_name: users.full_name,
      creator_username: users.username,
      creator_avatar: profiles.avatar_url,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, subscriptions.creator_id))
    .where(eq(subscriptions.subscriber_id, auth.user.userId))
    .orderBy(desc(subscriptions.created_at));

  return ok({ subscriptions: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(
    req,
    z.object({
      creator_id: z.string().min(1),
      // tier is optional — defaults to "subscriber".
      // subscriber      → creator's subscription_price
      // subscriber_plus → creator's subscription_price × 2 (exclusive tier)
      tier: z.enum(["subscriber", "subscriber_plus"]).optional(),
    }),
  );
  if (!parsed.success) return parsed.response;

  const { creator_id, tier } = parsed.data;
  if (creator_id === auth.user.userId) return err("Cannot subscribe to yourself", 400);

  const [creator] = await db
    .select({ id: users.id, is_creator: users.is_creator })
    .from(users)
    .where(eq(users.id, creator_id))
    .limit(1);
  // Subscription functionality is creator-only. A non-creator account can
  // never be a subscription target — enforced here server-side so it is
  // impossible even if a stale/hand-crafted request reaches the API.
  if (!creator) return err("Creator not found", 404);
  if (!creator.is_creator) return err("This account cannot be subscribed to", 400);

  // Resolve price from the same authoritative sources as /creators/[id] so the
  // charge here can never differ from the price the profile advertises.
  const [settings] = await db
    .select({ subscription_price: creator_settings.subscription_price })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, creator_id))
    .limit(1);
  const [profile] = await db
    .select({ subscription_price: profiles.subscription_price })
    .from(profiles)
    .where(eq(profiles.user_id, creator_id))
    .limit(1);

  const creatorPrice = resolveBasePrice(settings?.subscription_price, profile?.subscription_price);
  const resolvedTier: "subscriber" | "subscriber_plus" = tier ?? "subscriber";
  const multiplier = TIER_MULTIPLIER[resolvedTier] ?? 1;
  const [tierSettings] = await db
    .select({ subscription_plus_price: creator_settings.subscription_plus_price })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, creator_id))
    .limit(1);
  const price = resolvedTier === "subscriber_plus"
    ? Math.round(tierSettings?.subscription_plus_price ?? creatorPrice * multiplier)
    : Math.round(creatorPrice);

  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const subId = generateId();

  // Atomic debit + transaction + subscription insert (see creators/[id]/subscribe).
  type Outcome = { kind: "existing" | "created"; id: string; tier: "subscriber" | "subscriber_plus" };
  let outcome!: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
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
        return { kind: "existing", id: existing.id, tier: existing.tier ?? resolvedTier };
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
          metadata: JSON.stringify({ creator_id, tier: resolvedTier }),
        });
      }

      if (price > 0) {
        await recordCreatorEarning(tx, {
          creatorId: creator_id,
          buyerId: auth.user.userId,
          sourceType: "subscription",
          sourceId: subId,
          grossAmount: price,
          description: `Subscription from a fan (${auth.user.userId})`,
          metadata: { subscriber_id: auth.user.userId, tier: resolvedTier },
        });
      }

      await tx.insert(subscriptions).values({
        id: subId,
        subscriber_id: auth.user.userId,
        creator_id,
        status: "active",
        tier: resolvedTier,
        amount: price,
        started_at: now,
        expires_at: expires,
      });

      return { kind: "created", id: subId, tier: resolvedTier };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      return err("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
    }
    throw error;
  }

  if (outcome.kind === "existing") {
    const sub = {
      id: outcome.id,
      creator_id,
      status: "active" as const,
      amount: price,
      started_at: now,
      expires_at: expires,
    };
    return ok({ subscription_id: outcome.id, subscribed: true, tier: outcome.tier, subscription: sub });
  }

  const sub = { id: subId, creator_id, status: "active" as const, amount: price, started_at: now, expires_at: expires };

  // Notify the creator about their new subscriber — gated by their New
  // Subscribers preference (authoritative server-side).
  await createNotification(creator_id, "notif_new_subscribers", {
    actor_id: auth.user.userId,
    type: "subscribe",
    entity_type: "user",
    entity_id: auth.user.userId,
    body: "just subscribed to you",
  });

  getActorUsername(auth.user.userId).then((actor) =>
    sendPushToUser(creator_id, {
      title: "New Subscriber",
      body: `${actor} just subscribed to you`,
      data: {
        type: "subscribe",
        wallet: true,
        actor_id: auth.user.userId,
        actor_username: actor.replace(/^@/, ""),
      },
    }, "notif_new_subscribers"),
  );

  return created({ subscribed: true, subscription_id: subId, tier: resolvedTier, subscription: sub });
}
