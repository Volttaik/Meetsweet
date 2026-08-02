import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, subscriptions, creator_settings, wallets, transactions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

// Tier price mapping
const TIER_PRICES: Record<string, number> = {
  free: 0,
  normal: 200,
  premium: 500,
  vip: 1000,
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

  const parsed = await parseBody(req, z.object({
    creator_id: z.string().min(1),
    tier: z.enum(["free", "normal", "premium", "vip"]).optional().default("normal"),
  }));
  if (!parsed.success) return parsed.response;

  const { creator_id, tier } = parsed.data;
  if (creator_id === auth.user.userId) return err("Cannot subscribe to yourself", 400);

  const [creator] = await db.select({ id: users.id }).from(users).where(eq(users.id, creator_id)).limit(1);
  if (!creator) return err("Creator not found", 404);

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.subscriber_id, auth.user.userId), eq(subscriptions.creator_id, creator_id)))
    .limit(1);
  if (existing) return err("Already subscribed", 409);

  // Calculate subscription amount based on tier
  const tierPrice = TIER_PRICES[tier] ?? 0;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Check wallet balance
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.user_id, auth.user.userId))
    .limit(1);

  const balance = wallet?.balance ?? 0;
  if (balance < tierPrice) {
    return err("Insufficient wallet balance", 400);
  }

  // Deduct from wallet
  if (tierPrice > 0) {
    await db
      .update(wallets)
      .set({ balance: balance - tierPrice, updated_at: now })
      .where(eq(wallets.user_id, auth.user.userId));

    // Credit creator's wallet
    const [creatorWallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.user_id, creator_id))
      .limit(1);

    if (creatorWallet) {
      await db
        .update(wallets)
        .set({
          balance: (creatorWallet.balance ?? 0) + tierPrice,
          updated_at: now,
        })
        .where(eq(wallets.user_id, creator_id));
    }

    // Create transaction record
    await db.insert(transactions).values({
      id: generateId(),
      user_id: auth.user.userId,
      type: "subscription",
      amount: -tierPrice,
      status: "completed",
      description: `Subscribe to creator (${tier} tier)`,
      metadata: JSON.stringify({
        creator_id,
        tier,
      }),
    });
  }

  const subscriptionId = generateId();
  await db.insert(subscriptions).values({
    id: subscriptionId,
    subscriber_id: auth.user.userId,
    creator_id,
    status: "active",
    amount: tierPrice,
    started_at: now,
    expires_at: expires,
  });

  return created({
    subscription_id: subscriptionId,
    subscription: {
      id: subscriptionId,
      creator_id,
      tier,
      status: "active",
      amount: tierPrice,
      started_at: now,
      expires_at: expires,
    },
  });
}
