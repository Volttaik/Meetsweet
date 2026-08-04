import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, subscriptions, creator_settings } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

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

  const parsed = await parseBody(req, z.object({ creator_id: z.string().min(1) }));
  if (!parsed.success) return parsed.response;

  const { creator_id } = parsed.data;
  if (creator_id === auth.user.userId) return err("Cannot subscribe to yourself", 400);

  const [creator] = await db.select({ id: users.id }).from(users).where(eq(users.id, creator_id)).limit(1);
  if (!creator) return err("Creator not found", 404);

  const [existing] = await db
    .select({ id: subscriptions.id, status: subscriptions.status })
    .from(subscriptions)
    .where(and(eq(subscriptions.subscriber_id, auth.user.userId), eq(subscriptions.creator_id, creator_id)))
    .limit(1);
  // Idempotent: return existing active subscription instead of erroring
  if (existing && existing.status === "active") {
    return ok({ subscription_id: existing.id, subscribed: true, subscription: existing });
  }

  const [settings] = await db
    .select({ subscription_price: creator_settings.subscription_price })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, creator_id))
    .limit(1);

  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.insert(subscriptions).values({
    id: generateId(),
    subscriber_id: auth.user.userId,
    creator_id,
    status: "active",
    amount: settings?.subscription_price ?? 0,
    started_at: now,
    expires_at: expires,
  });

  return created({ subscribed: true });
}
