import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, creator_settings, user_settings } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

/**
 * GET /api/subscriptions/check/:creatorId
 * 
 * Check if the current user is subscribed to a specific creator.
 * Also returns the creator's messaging settings.
 * 
 * Response:
 * - subscribed: boolean - whether the user has an active subscription
 * - who_can_message: 'everyone' | 'subscribers' | 'none' - creator's messaging preference
 * - can_message: boolean - whether the user can message the creator
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ creatorId: string }> },
) {
  const { creatorId } = await params;
  const auth = await optionalAuth(req);

  // Get subscription status
  let subscribed = false;
  if (auth?.userId) {
    const [sub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.subscriber_id, auth.userId),
          eq(subscriptions.creator_id, creatorId),
          eq(subscriptions.status, "active"),
        ),
      )
      .limit(1);
    subscribed = !!sub;
  }

  // Get creator's messaging settings
  const [settings] = await db
    .select({
      who_can_message: creator_settings.who_can_message,
    })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, creatorId))
    .limit(1);

  const whoCanMessage = settings?.who_can_message ?? "everyone";

  // The recipient's own privacy policy (Who Can Message Me) is enforced here
  // too, mirroring messagingAllowedError() server-side.
  const [privacy] = await db
    .select({ allow_dms: user_settings.allow_dms, message_perm: user_settings.message_perm })
    .from(user_settings)
    .where(eq(user_settings.user_id, creatorId))
    .limit(1);
  let privacyAllows = true;
  if (privacy) {
    if (privacy.allow_dms === false || privacy.message_perm === "nobody") privacyAllows = false;
    else if (privacy.message_perm === "subscribers") privacyAllows = subscribed;
  }

  // Determine if user can message
  let canMessage = false;
  if (whoCanMessage === "everyone") {
    canMessage = privacyAllows;
  } else if (whoCanMessage === "subscribers") {
    canMessage = subscribed && privacyAllows;
  } else {
    // 'none' - no one can message
    canMessage = false;
  }

  return ok({
    subscribed,
    who_can_message: whoCanMessage,
    can_message: canMessage,
  });
}
