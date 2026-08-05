import { NextRequest } from "next/server";
import { eq, and, desc, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, media, users, profiles, post_likes, subscriptions } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { buildVideoRow, groupMediaByPost } from "@/lib/services/content";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const videoId = params.get("video_id") ?? "";
  const limit = Math.min(Math.max(1, Number(params.get("limit") ?? 10)), 20);
  const userId = (await optionalAuth(req))?.userId ?? null;

  const conditions = and(
    isNull(posts.deleted_at),
    eq(posts.status, "published"),
    eq(posts.content_type, "video"),
    eq(posts.visibility, "public"),
    videoId ? ne(posts.id, videoId) : undefined,
  );

  const rows = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      title: posts.title,
      caption: posts.caption,
      description: posts.description,
      visibility: posts.visibility,
      view_count: posts.view_count,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      share_count: posts.share_count,
      // tier and thumbnail_url required by buildVideoRow for access gating + response shape
      tier: posts.tier,
      thumbnail_url: posts.thumbnail_url,
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
    .where(conditions)
    .orderBy(desc(posts.like_count), desc(posts.published_at))
    .limit(limit);

  const postIds = rows.map((p) => p.id);

  const mediaRows = postIds.length > 0
    ? await db.select().from(media).where(sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`)
    : [];

  const likedSet: Set<string> = userId && postIds.length > 0
    ? await db.select({ post_id: post_likes.post_id }).from(post_likes)
        .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`))
        .then((r) => new Set(r.map((x) => x.post_id)))
    : new Set();

  const subscribedSet: Set<string> = userId
    ? await db.select({ creator_id: subscriptions.creator_id }).from(subscriptions)
        .where(and(eq(subscriptions.subscriber_id, userId), eq(subscriptions.status, "active")))
        .then((r) => new Set(r.map((x) => x.creator_id)))
    : new Set();

  const mediaByPost = groupMediaByPost(mediaRows);

  const videos = rows.map((p) =>
    buildVideoRow(p, mediaByPost[p.id] ?? [], likedSet.has(p.id), subscribedSet.has(p.creator_id)),
  );

  return ok({ videos, items: videos });
}
