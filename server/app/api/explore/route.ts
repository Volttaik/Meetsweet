import { NextRequest } from "next/server";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, posts, media, post_likes, saved_posts, post_unlocks } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);
  const offset = (page - 1) * limit;

  const userId = await optionalAuth(req).then((a) => a?.userId ?? null);

  // Return public posts for the explore feed, with media attached
  const postRows = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: users.is_verified,
      caption: posts.caption,
      visibility: posts.visibility,
      unlock_price: posts.unlock_price,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      save_count: posts.save_count,
      view_count: posts.view_count,
      created_at: posts.created_at,
      published_at: posts.published_at,
      updated_at: posts.updated_at,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(
      and(
        isNull(posts.deleted_at),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
        eq(posts.content_type, "post"),
      ),
    )
    .orderBy(desc(posts.published_at))
    .limit(limit)
    .offset(offset);

  // Attach media to each post
  const postIds = postRows.map((p) => p.id);
  let mediaByPost: Record<string, unknown[]> = {};

  if (postIds.length > 0) {
    const allMedia = await db
      .select()
      .from(media)
      .where(
        sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`,
      );

    mediaByPost = allMedia.reduce(
      (acc, m) => {
        if (!m.post_id) return acc;
        if (!acc[m.post_id]) acc[m.post_id] = [];
        acc[m.post_id].push({
          url: m.url,
          type: m.type,
          thumbnail_url: m.thumbnail_url ?? null,
          duration_secs: m.duration_seconds,
          file_size: m.size_bytes,
          width: m.width,
          height: m.height,
        });
        return acc;
      },
      {} as Record<string, unknown[]>,
    );
  }

  // Liked / bookmarked sets for the current user
  let likedSet = new Set<string>();
  let savedSet = new Set<string>();
  let unlockedSet = new Set<string>();
  if (userId && postIds.length > 0) {
    const liked = await db
      .select({ post_id: post_likes.post_id })
      .from(post_likes)
      .where(
        and(
          eq(post_likes.user_id, userId),
          sql`${post_likes.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      );
    likedSet = new Set(liked.map((l) => l.post_id));

    const saved = await db
      .select({ post_id: saved_posts.post_id })
      .from(saved_posts)
      .where(
        and(
          eq(saved_posts.user_id, userId),
          sql`${saved_posts.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      );
    savedSet = new Set(saved.map((s) => s.post_id));

    const unlocked = await db
      .select({ post_id: post_unlocks.post_id })
      .from(post_unlocks)
      .where(
        and(
          eq(post_unlocks.user_id, userId),
          sql`${post_unlocks.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      );
    unlockedSet = new Set(unlocked.map((u) => u.post_id));
  }

  const enrichedPosts = postRows.map((p) => {
    const isLocked = (p.unlock_price ?? 0) > 0 && p.creator_id !== userId && !unlockedSet.has(p.id);
    return {
      ...p,
      media: (mediaByPost[p.id] ?? []).map((item) => {
        const mediaItem = item as Record<string, unknown>;
        return isLocked
          ? { ...mediaItem, url: null, thumbnail_url: null, is_locked: true }
          : { ...mediaItem, is_locked: false };
      }),
      is_locked: isLocked,
      liked_by_me: likedSet.has(p.id),
      bookmarked_by_me: savedSet.has(p.id),
    };
  });

  // Return featured creators (is_creator=true)
  const creatorRows = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      avatar_url: profiles.avatar_url,
      bio: profiles.bio,
      is_verified: users.is_verified,
      is_creator: users.is_creator,
      is_verified_creator: profiles.is_verified_creator,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.is_creator, true))
    .limit(limit)
    .offset(offset);

  return ok({
    posts: enrichedPosts,
    users: creatorRows.map((u) => ({
      id: u.id,
      name: u.full_name,
      full_name: u.full_name,
      username: u.username,
      avatar_url: u.avatar_url,
      avatarUrl: u.avatar_url,
      bio: u.bio,
      is_verified: u.is_verified,
      isVerified: u.is_verified,
      is_creator: u.is_creator,
      is_verified_creator: u.is_verified_creator,
    })),
  });
}
