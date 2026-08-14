import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { creator_settings, subscriptions, users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

/**
 * GET /api/creators/:id/messaging-settings
 *
 * Returns the creator's messaging policy PLUS the requesting user's
 * subscription state, so the mobile client can decide whether the current user
 * may open a chat room. Mirrors the /subscriptions/check/:creatorId contract.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [creator] = await db
    .select({ id: users.id, is_creator: users.is_creator })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  const [settings] = await db
    .select({
      who_can_message: creator_settings.who_can_message,
      subscription_price: creator_settings.subscription_price,
      subscription_plus_price: creator_settings.subscription_plus_price,
    })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, id))
    .limit(1);

  // Default: everyone can message non-creators or creators without settings.
  const who_can_message = creator?.is_creator
    ? (settings?.who_can_message ?? "everyone")
    : "everyone";

  // Current user's subscription state for this creator.
  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.subscriber_id, auth.user.userId),
        eq(subscriptions.creator_id, id),
        eq(subscriptions.status, "active"),
      ),
    )
    .limit(1);
  const subscribed = Boolean(sub);

  const can_message =
    who_can_message === "everyone" ||
    (who_can_message === "subscribers" && subscribed);

  return ok({
    who_can_message,
    whoCanMessage: who_can_message,
    subscribed,
    can_message,
    subscription_price: settings?.subscription_price ?? 0,
    subscription_plus_price: settings?.subscription_plus_price ?? null,
  });
}
