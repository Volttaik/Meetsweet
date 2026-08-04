import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, media, users, profiles, post_likes, subscriptions, comments } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { buildVideoRow, canViewContent } from "@/lib/services/content";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = (await optionalAuth(req))?.userId ?? null;

  const [row] = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      title: posts.title,
      caption: posts.caption,
      description: posts.description,
      visibility: posts.visibility,
      tier: posts.tier,
      thumbnail_url: posts.thumbnail_url,
      unlock_price: posts.unlock_price,
      view_count: posts.view_count,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      share_count: posts.share_count,
      created_at: posts.created_at,
      published_at: posts.published_at,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: users.is_verified,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(and(eq(posts.id, id), isNull(posts.deleted_at), eq(posts.content_type, "video")))
    .limit(1);

  if (!row) return err("Video not found", 404);

  const [mediaRows, liked, subscription, previewComments] = await Promise.all([
    db.select().from(media).where(eq(media.post_id, id)),
    userId
      ? db.select({ id: post_likes.id }).from(post_likes)
          .where(and(eq(post_likes.user_id, userId), eq(post_likes.post_id, id)))
          .then((r) => r.length > 0)
      : false,
    userId
      ? db.select({ id: subscriptions.id, tier: subscriptions.tier }).from(subscriptions)
          .where(and(
            eq(subscriptions.subscriber_id, userId),
            eq(subscriptions.creator_id, row.creator_id),
            eq(subscriptions.status, "active"),
          ))
          .then((r) => r[0] ?? null)
      : null,
    db.select({
      id: comments.id,
      body: comments.body,
      like_count: comments.like_count,
      created_at: comments.created_at,
      author_id: users.id,
      author_name: users.full_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
    })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.author_id))
      .leftJoin(profiles, eq(profiles.user_id, comments.author_id))
      .where(and(eq(comments.post_id, id), isNull(comments.deleted_at)))
      .limit(2),
  ]);

  const isSubscribed = subscription !== null;
  const subTier = subscription?.tier ?? null;
  const isOwner = userId === row.creator_id;

  // Enforce access: subscriber-only or tier-gated content
  if (!canViewContent(row.visibility, row.tier, isSubscribed, subTier, isOwner)) {
    const code = row.tier ? "TIER_REQUIRED" : "SUBSCRIPTION_REQUIRED";
    return err(
      row.tier
        ? `A ${row.tier}-tier subscription is required to view this video`
        : "A subscription is required to view this video",
      403,
      code,
    );
  }

  const video = buildVideoRow(row, mediaRows, liked, isSubscribed, previewComments, subTier);
  return ok({ video });
}
