import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, users, profiles } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, created, err } from "@/lib/api/response";
import { z } from "zod";
import { generateId } from "@/lib/auth/codes";

const subscribeSchema = z.object({
  creator_id: z.string().uuid(),
  transaction_reference: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const rows = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      amount: subscriptions.amount,
      currency: subscriptions.currency,
      started_at: subscriptions.started_at,
      expires_at: subscriptions.expires_at,
      created_at: subscriptions.created_at,
      creator_id: subscriptions.creator_id,
      creator_username: users.username,
      creator_avatar: profiles.avatar_url,
      creator_display_name: profiles.display_name,
    })
    .from(subscriptions)
    .leftJoin(users, eq(users.id, subscriptions.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, subscriptions.creator_id))
    .where(eq(subscriptions.subscriber_id, auth.user.userId))
    .orderBy(desc(subscriptions.created_at));

  return ok(rows);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, subscribeSchema);
  if (!parsed.success) return parsed.response;
  const { creator_id } = parsed.data;

  if (creator_id === auth.user.userId) return err("Cannot subscribe to yourself", 400);

  const [creator] = await db
    .select({ id: users.id, subscription_price: profiles.subscription_price })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(and(eq(users.id, creator_id), eq(users.is_creator, true)))
    .limit(1);

  if (!creator) return err("Creator not found", 404);

  const [existing] = await db
    .select({ id: subscriptions.id, status: subscriptions.status })
    .from(subscriptions)
    .where(and(eq(subscriptions.subscriber_id, auth.user.userId), eq(subscriptions.creator_id, creator_id)))
    .limit(1);

  if (existing?.status === "active") return err("Already subscribed", 409);

  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const subId = generateId();
  await db.insert(subscriptions).values({
    id: subId,
    subscriber_id: auth.user.userId,
    creator_id,
    status: "active",
    amount: creator.subscription_price ?? 0,
    started_at: now,
    expires_at: expires,
  });

  return created({ id: subId }, "Subscribed");
}
