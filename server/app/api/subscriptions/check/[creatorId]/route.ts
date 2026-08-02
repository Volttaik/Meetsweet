import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, creator_settings } from "@/lib/db/schema";
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

  // Determine if user can message
  let canMessage = false;
  if (whoCanMessage === "everyone") {
    canMessage = true;
  } else if (whoCanMessage === "subscribers") {
    canMessage = subscribed;
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
