import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { blocked_users, creator_settings, subscriptions, users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

/**
 * GET /api/creators/:id/messaging-settings
 *
 * Returns the creator's PRIVATE INBOX pricing (server-authoritative — the
 * client displays this price but never dictates it) plus just enough context
 * for the Compose screen: whether the inbox is open to this viewer and what
 * a message will cost.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const viewerId = auth.user.userId;

  const [creator] = await db
    .select({ id: users.id, is_creator: users.is_creator, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!creator) return ok({ enabled: false, can_message: false, price: 0 });

  const [settings] = await db
    .select({
      private_inbox_enabled: creator_settings.private_inbox_enabled,
      private_message_price: creator_settings.private_message_price,
      who_can_message: creator_settings.who_can_message,
    })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, id))
    .limit(1);

  const enabled = Boolean(creator.is_creator) && creator.role === "creator" && (settings?.private_inbox_enabled ?? true);

  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.subscriber_id, viewerId),
        eq(subscriptions.creator_id, id),
        eq(subscriptions.status, "active"),
      ),
    )
    .limit(1);

  // Viewer-side block? A creator who blocked the viewer must not be messaged.
  const [blocked] = await db
    .select({ id: blocked_users.id })
    .from(blocked_users)
    .where(and(eq(blocked_users.blocker_id, id), eq(blocked_users.blocked_id, viewerId)))
    .limit(1);

  return ok({
    enabled,
    price: settings?.private_message_price ?? 100,
    subscribed: Boolean(sub),
    blocked: Boolean(blocked),
    is_self: viewerId === id,
    // Subscriber-only access: an active subscription is always required to
    // send (the legacy "everyone" mode is treated as subscriber-only too).
    can_message: enabled && !blocked && viewerId !== id && (settings?.who_can_message !== "none") && Boolean(sub),
    // Legacy aliases kept so older clients fail soft instead of crashing.
    who_can_message: settings?.who_can_message ?? "everyone",
    whoCanMessage: settings?.who_can_message ?? "everyone",
    subscription_price: 0,
    subscription_plus_price: null,
  });
}
