import { NextRequest } from "next/server";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts, media, users, profiles, post_likes, subscriptions, post_categories } from "@/lib/db/schema";
import { optionalAuth, requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, created } from "@/lib/api/response";
import { buildVideoRow, groupMediaByPost } from "@/lib/services/content";
import { generateId } from "@/lib/auth/codes";

const createSchema = z.object({
  title: z.string().max(300).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  caption: z.string().max(2200).nullable().optional(),
  visibility: z.enum(["public", "subscribers", "draft"]).default("public"),
  tier: z.enum(["bronze", "silver", "gold", "diamond"]).nullable().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  preview_duration: z.number().int().min(1).nullable().optional(),
  unlock_price: z.number().int().min(0).nullable().optional(),
  media_ids: z.array(z.string()).max(10).optional(),
  media: z
    .array(
      z.object({
        url: z.string().url(),
        blob_path: z.string().min(1),
        type: z.enum(["image", "video"]),
        mime_type: z.string().optional(),
        size_bytes: z.number().int().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        duration_seconds: z.number().optional(),
        thumbnail_url: z.string().url().nullable().optional(),
      }),
    )
    .max(10)
    .optional(),
  categories: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const cursor = params.get("cursor");
  const limit = Math.min(Math.max(1, Number(params.get("limit") ?? 20)), 50);
  const userId = (await optionalAuth(req))?.userId ?? null;

  const conditions = and(
    isNull(posts.deleted_at),
    eq(posts.status, "published"),
    eq(posts.content_type, "video"),
    eq(posts.visibility, "public"),
    cursor ? sql`${posts.created_at} < ${cursor}` : undefined,
  );

  const rows = await db
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
    .where(conditions)
    .orderBy(desc(posts.published_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const postIds = items.map((p) => p.id);

  const mediaRows = postIds.length > 0
    ? await db.select().from(media).where(sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`)
    : [];

  const likedSet: Set<string> = userId && postIds.length > 0
    ? await db.select({ post_id: post_likes.post_id }).from(post_likes)
        .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`))
        .then((r) => new Set(r.map((x) => x.post_id)))
    : new Set();

  // Map of creator_id → subscription tier (null = subscribed with no tier stored yet)
  const subscriptionMap: Map<string, string | null> = userId
    ? await db
        .select({ creator_id: subscriptions.creator_id, tier: subscriptions.tier })
        .from(subscriptions)
        .where(and(eq(subscriptions.subscriber_id, userId), eq(subscriptions.status, "active")))
        .then((r) => new Map(r.map((x) => [x.creator_id, x.tier])))
    : new Map();

  const mediaByPost = groupMediaByPost(mediaRows);

  const videos = items.map((p) => {
    const isSubscribed = subscriptionMap.has(p.creator_id);
    const subTier = subscriptionMap.get(p.creator_id) ?? null;
    return buildVideoRow(p, mediaByPost[p.id] ?? [], likedSet.has(p.id), isSubscribed, [], subTier);
  });

  return ok({
    videos,
    items: videos,
    next_cursor: hasMore ? items[items.length - 1]?.created_at ?? null : null,
    has_more: hasMore,
    hasMore,
  });
}

/**
 * POST /api/videos — Create a long-form video.
 * Stores as a posts row with content_type = 'video'.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;

  const {
    title, description, caption, visibility,
    tier, thumbnail_url, tags,
    preview_duration, unlock_price,
    media_ids, media: mediaItems, categories,
  } = parsed.data;

  const postId = generateId();
  const now = new Date().toISOString();

  await db.insert(posts).values({
    id: postId,
    creator_id: auth.user.userId,
    content_type: "video",
    title: title ?? null,
    description: description ?? caption ?? null,
    caption: caption ?? null,
    thumbnail_url: thumbnail_url ?? null,
    tier: tier ?? null,
    tags: tags && tags.length > 0 ? JSON.stringify(tags) : null,
    visibility: visibility ?? "public",
    status: "published",
    preview_duration: preview_duration ?? null,
    unlock_price: unlock_price ?? null,
    published_at: now,
  });

  if (mediaItems && mediaItems.length > 0) {
    await db.insert(media).values(
      mediaItems.map((m, i) => ({
        id: generateId(),
        post_id: postId,
        uploader_id: auth.user.userId,
        url: m.url,
        blob_path: m.blob_path,
        type: m.type,
        mime_type: m.mime_type ?? null,
        size_bytes: m.size_bytes ?? null,
        width: m.width ?? null,
        height: m.height ?? null,
        duration_seconds: m.duration_seconds ?? null,
        thumbnail_url: m.thumbnail_url ?? null,
        sort_order: i,
      })),
    );
  }

  if (media_ids && media_ids.length > 0) {
    for (let i = 0; i < media_ids.length; i++) {
      await db
        .update(media)
        .set({ post_id: postId, sort_order: i })
        .where(and(eq(media.id, media_ids[i]), eq(media.uploader_id, auth.user.userId)));
    }
  }

  if (categories && categories.length > 0) {
    await db.insert(post_categories).values(
      categories.map((categoryId) => ({
        id: generateId(),
        post_id: postId,
        category_id: categoryId,
      })),
    ).onConflictDoNothing();
  }

  return created({ id: postId });
}
