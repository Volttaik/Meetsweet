import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, subscriptions, creator_settings, wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

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

  const [creator] = await db.select({ id: users.id }).from(users).where(eq(users.id, creator_id)).limit(1);
  if (!creator) return err("Creator not found", 404);

  const [existing] = await db
    .select({ id: subscriptions.id, status: subscriptions.status, tier: subscriptions.tier })
    .from(subscriptions)
    .where(and(eq(subscriptions.subscriber_id, auth.user.userId), eq(subscriptions.creator_id, creator_id)))
    .limit(1);

  // Idempotent: return existing active subscription instead of erroring
  if (existing && existing.status === "active") {
    const [current] = await db
      .select({
        id: subscriptions.id,
        tier: subscriptions.tier,
        amount: subscriptions.amount,
        started_at: subscriptions.started_at,
        expires_at: subscriptions.expires_at,
      })
      .from(subscriptions)
      .where(eq(subscriptions.id, existing.id))
      .limit(1);
    const sub = {
      id: existing.id,
      creator_id,
      status: "active" as const,
      amount: current?.amount ?? 0,
      started_at: current?.started_at ?? "",
      expires_at: current?.expires_at ?? "",
    };
    return ok({ subscription_id: existing.id, subscribed: true, tier: current?.tier ?? existing.tier, subscription: sub });
  }

  // Resolve price from creator's subscription_price setting.
  //   subscriber      → 1× creator price
  //   subscriber_plus → 2× creator price (exclusive premium tier)
  const [settings] = await db
    .select({ subscription_price: creator_settings.subscription_price })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, creator_id))
    .limit(1);

  const creatorPrice = settings?.subscription_price ?? 0;
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

  // Charge wallet if subscription has a cost
  if (price > 0) {
    const [wallet] = await db
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.user_id, auth.user.userId))
      .limit(1);

    if (!wallet || (wallet.balance ?? 0) < price) {
      return err("Insufficient wallet balance", 400, "INSUFFICIENT_BALANCE");
    }

    const now = new Date().toISOString();
    await db
      .update(wallets)
      .set({ balance: (wallet.balance ?? 0) - price, updated_at: now })
      .where(eq(wallets.id, wallet.id));

    await db.insert(transactions).values({
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

  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const subId = generateId();
  await db.insert(subscriptions).values({
    id: subId,
    subscriber_id: auth.user.userId,
    creator_id,
    status: "active",
    tier: resolvedTier,
    amount: price,
    started_at: now,
    expires_at: expires,
  });

  const sub = { id: subId, creator_id, status: "active" as const, amount: price, started_at: now, expires_at: expires };
  return created({ subscribed: true, subscription_id: subId, tier: resolvedTier, subscription: sub });
}
