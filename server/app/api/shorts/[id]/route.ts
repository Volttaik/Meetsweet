import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, media, users, profiles, post_likes, subscriptions } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { buildShortRow } from "@/lib/services/content";

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
      caption: posts.caption,
      title: posts.title,
      visibility: posts.visibility,
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
    .where(and(eq(posts.id, id), isNull(posts.deleted_at), eq(posts.content_type, "short")))
    .limit(1);

  if (!row) return err("Short not found", 404);

  const [mediaRows, liked, subscribed] = await Promise.all([
    db.select().from(media).where(eq(media.post_id, id)),
    userId
      ? db.select({ id: post_likes.id }).from(post_likes)
          .where(and(eq(post_likes.user_id, userId), eq(post_likes.post_id, id)))
          .then((r) => r.length > 0)
      : false,
    userId
      ? db.select({ id: subscriptions.id }).from(subscriptions)
          .where(and(eq(subscriptions.subscriber_id, userId), eq(subscriptions.creator_id, row.creator_id), eq(subscriptions.status, "active")))
          .then((r) => r.length > 0)
      : false,
  ]);

  const short = buildShortRow(row, mediaRows, liked, subscribed);
  return ok({ short });
}
