import { NextRequest } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { emitEvent } from "@/lib/realtime/emit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [sub] = await db
    .select({ id: subscriptions.id, subscriber_id: subscriptions.subscriber_id, creator_id: subscriptions.creator_id, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .limit(1);

  if (!sub) return err("Subscription not found", 404);
  if (sub.subscriber_id !== auth.user.userId) return err("Forbidden", 403);
  if (sub.status === "cancelled") return err("Subscription is already cancelled", 400);

  const now = new Date().toISOString();
  await db
    .update(subscriptions)
    .set({ status: "cancelled", cancelled_at: now, updated_at: now })
    .where(eq(subscriptions.id, id));

  // Realtime: the creator's connected devices drop the subscriber count and
  // the subscriber's own state flips to cancelled immediately — no refresh.
  const [subCountRow] = await db
    .select({ n: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.creator_id, sub.creator_id), eq(subscriptions.status, "active")));
  void emitEvent({
    type: "subscription:cancelled",
    channel: `user:${sub.creator_id}`,
    resourceId: sub.creator_id,
    userId: auth.user.userId,
    payload: { creatorId: sub.creator_id, subscriberId: sub.subscriber_id, subscriberCount: subCountRow?.n ?? 0 },
  });

  return ok({ cancelled: true });
}
