import { NextRequest } from "next/server";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, posts, media, post_likes, saved_posts, follows } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const createSchema = z.object({
  caption: z.string().max(2200).nullable().optional(),
  visibility: z.enum(["public", "subscribers", "draft"]).default("public"),
  preview_duration: z.number().int().min(1).nullable().optional(),
  unlock_price: z.number().int().min(0).nullable().optional(),
  expires_at: z.string().optional(),
  // media_ids: IDs of pre-uploaded media records (from POST /api/media)
  media_ids: z.array(z.string()).max(10).optional(),
  // media: inline media objects (legacy / direct creation path)
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
      }),
    )
    .max(10)
    .optional(),
  // categories/tags accepted but not yet stored
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

function postRow(p: Record<string, unknown>, mediaItems: unknown[], liked: boolean, bookmarked: boolean) {
  return {
    id: p.id,
    creator_id: p.creator_id,
    creator_username: p.creator_username,
    creator_display_name: p.creator_display_name,
    creator_avatar: p.creator_avatar,
    creator_is_verified: p.creator_is_verified,
    caption: p.caption,
    visibility: p.visibility,
    status: p.status,
    is_pinned: p.is_pinned,
    preview_duration: p.preview_duration,
    unlock_price: p.unlock_price,
    like_count: p.like_count,
    comment_count: p.comment_count,
    save_count: p.save_count,
    view_count: p.view_count,
    published_at: p.published_at,
    created_at: p.created_at,
    updated_at: p.updated_at,
    liked_by_me: liked,
    bookmarked_by_me: bookmarked,
    media: mediaItems,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const bookmarked = searchParams.get("bookmarked") === "true";
  const creatorId = searchParams.get("creator_id");
  const cursor = searchParams.get("cursor");
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);

  let userId: string | null = null;
  const authResult = await requireAuth(req);
  if (!("response" in authResult)) {
    userId = authResult.user.userId;
  }

  if (bookmarked && !userId) {
    return err("Authentication required", 401);
  }

  const baseSelect = db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: users.is_verified,
      caption: posts.caption,
      visibility: posts.visibility,
      status: posts.status,
      is_pinned: posts.is_pinned,
      preview_duration: posts.preview_duration,
      unlock_price: posts.unlock_price,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      save_count: posts.save_count,
      view_count: posts.view_count,
      published_at: posts.published_at,
      created_at: posts.created_at,
      updated_at: posts.updated_at,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id));

  let conditions = and(isNull(posts.deleted_at), eq(posts.status, "published"));

  if (bookmarked && userId) {
    const bookmarkedIds = await db
      .select({ post_id: saved_posts.post_id })
      .from(saved_posts)
      .where(eq(saved_posts.user_id, userId));
    const ids = bookmarkedIds.map((b) => b.post_id);
    if (ids.length === 0) return ok({ posts: [], nextCursor: null });
    conditions = and(conditions, sql`${posts.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  }

  if (creatorId) {
    conditions = and(conditions, eq(posts.creator_id, creatorId));
  }

  const rows = await baseSelect
    .where(conditions)
    .orderBy(desc(posts.published_at))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const postIds = items.map((p) => p.id);
  if (postIds.length === 0) return ok({ posts: [], nextCursor: null });

  const allMedia = await db
    .select()
    .from(media)
    .where(sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`);

  let likedSet = new Set<string>();
  let savedSet = new Set<string>();
  if (userId) {
    const liked = await db
      .select({ post_id: post_likes.post_id })
      .from(post_likes)
      .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`));
    likedSet = new Set(liked.map((l) => l.post_id));

    const saved = await db
      .select({ post_id: saved_posts.post_id })
      .from(saved_posts)
      .where(and(eq(saved_posts.user_id, userId), sql`${saved_posts.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`));
    savedSet = new Set(saved.map((s) => s.post_id));
  }

  const mediaByPost = allMedia.reduce(
    (acc, m) => {
      if (!m.post_id) return acc;
      if (!acc[m.post_id]) acc[m.post_id] = [];
      acc[m.post_id].push({ url: m.url, type: m.type, thumbnail_url: null, duration_secs: m.duration_seconds, file_size: m.size_bytes, width: m.width, height: m.height });
      return acc;
    },
    {} as Record<string, unknown[]>,
  );

  const result = items.map((p) =>
    postRow(p as Record<string, unknown>, mediaByPost[p.id] ?? [], likedSet.has(p.id), savedSet.has(p.id)),
  );

  return ok({
    posts: result,
    nextCursor: hasMore ? items[items.length - 1]?.created_at : null,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;

  const {
    caption,
    visibility,
    preview_duration,
    unlock_price,
    expires_at,
    media: mediaItems,
    media_ids,
  } = parsed.data;

  const postId = generateId();
  const now = new Date().toISOString();

  await db.insert(posts).values({
    id: postId,
    creator_id: auth.user.userId,
    caption: caption ?? null,
    visibility: visibility ?? "public",
    status: "published",
    preview_duration: preview_duration ?? null,
    unlock_price: unlock_price ?? null,
    expires_at: expires_at ?? null,
    published_at: now,
  });

  // Support inline media objects (legacy path)
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
        sort_order: i,
      })),
    );
  }

  // Support media_ids: associate pre-uploaded media records with this post
  if (media_ids && media_ids.length > 0) {
    for (let i = 0; i < media_ids.length; i++) {
      await db
        .update(media)
        .set({ post_id: postId, sort_order: i })
        .where(and(eq(media.id, media_ids[i]), eq(media.uploader_id, auth.user.userId)));
    }
  }

  // Return { id } — mobile only needs the post ID
  return created({ id: postId });
}
