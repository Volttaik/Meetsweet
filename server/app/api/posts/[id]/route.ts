import { NextRequest } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, posts, media, post_likes, saved_posts } from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const patchSchema = z.object({
  caption: z.string().max(2200).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  // content_type is intentionally omitted — once content is created as a short/video/post
  // it must never change type, otherwise it bleeds into the wrong feed and screen.
  // Use the dedicated /api/shorts, /api/videos endpoints to create the correct type.
  visibility: z.enum(["public", "subscribers", "draft"]).optional(),
  tier: z.enum(["bronze", "silver", "gold", "diamond"]).nullable().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  is_pinned: z.boolean().optional(),
  preview_duration: z.number().int().min(1).nullable().optional(),
  expires_at: z.string().nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [row] = await db
    .select({
      id: posts.id,
      content_type: posts.content_type,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: users.is_verified,
      caption: posts.caption,
      title: posts.title,
      description: posts.description,
      thumbnail_url: posts.thumbnail_url,
      tier: posts.tier,
      tags: posts.tags,
      visibility: posts.visibility,
      status: posts.status,
      is_pinned: posts.is_pinned,
      preview_duration: posts.preview_duration,
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
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(and(eq(posts.id, id), isNull(posts.deleted_at)))
    .limit(1);

  if (!row) return err("Post not found", 404);

  const postMedia = await db.select().from(media).where(eq(media.post_id, id));

  let likedByMe = false;
  let bookmarkedByMe = false;

  const authResult = await optionalAuth(req);
  if (authResult?.userId) {
    const uid = authResult.userId;
    const [liked] = await db
      .select({ id: post_likes.id })
      .from(post_likes)
      .where(and(eq(post_likes.user_id, uid), eq(post_likes.post_id, id)))
      .limit(1);
    likedByMe = !!liked;

    const [saved] = await db
      .select({ id: saved_posts.id })
      .from(saved_posts)
      .where(and(eq(saved_posts.user_id, uid), eq(saved_posts.post_id, id)))
      .limit(1);
    bookmarkedByMe = !!saved;
  }

  return ok({
    id: row.id,
    content_type: row.content_type ?? "post",
    creator_id: row.creator_id,
    creator_username: row.creator_username,
    creator_display_name: row.creator_display_name,
    creator_avatar: row.creator_avatar,
    creator_is_verified: row.creator_is_verified,
    caption: row.caption ?? null,
    title: row.title ?? null,
    description: row.description ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    tier: row.tier ?? null,
    tags: row.tags ? JSON.parse(row.tags) : [],
    visibility: row.visibility,
    status: row.status,
    is_pinned: row.is_pinned,
    preview_duration: row.preview_duration,
    like_count: row.like_count,
    likeCount: row.like_count,
    comment_count: row.comment_count,
    commentCount: row.comment_count,
    save_count: row.save_count,
    saveCount: row.save_count,
    share_count: row.share_count,
    shareCount: row.share_count,
    view_count: row.view_count,
    viewCount: row.view_count,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    liked_by_me: likedByMe,
    likedByMe,
    bookmarked_by_me: bookmarkedByMe,
    bookmarkedByMe,
    media: postMedia.map((m) => ({
      id: m.id,
      url: m.url,
      type: m.type,
      thumbnail_url: m.thumbnail_url ?? null,
      duration_secs: m.duration_seconds,
      file_size: m.size_bytes,
      width: m.width,
      height: m.height,
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db
    .select({ id: posts.id, creator_id: posts.creator_id })
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return err("Post not found", 404);
  if (post.creator_id !== auth.user.userId) return err("Forbidden", 403);

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;

  const { tags, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
  if (tags !== undefined) updates.tags = JSON.stringify(tags);

  await db
    .update(posts)
    .set(updates)
    .where(eq(posts.id, id));

  const [updated] = await db
    .select({
      id: posts.id,
      content_type: posts.content_type,
      creator_id: posts.creator_id,
      caption: posts.caption,
      title: posts.title,
      description: posts.description,
      thumbnail_url: posts.thumbnail_url,
      tier: posts.tier,
      tags: posts.tags,
      visibility: posts.visibility,
      status: posts.status,
      is_pinned: posts.is_pinned,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      save_count: posts.save_count,
      view_count: posts.view_count,
      published_at: posts.published_at,
      created_at: posts.created_at,
      updated_at: posts.updated_at,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  return ok({
    post: {
      ...updated,
      tags: updated?.tags ? JSON.parse(updated.tags) : [],
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db
    .select({ id: posts.id, creator_id: posts.creator_id })
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return err("Post not found", 404);
  if (post.creator_id !== auth.user.userId && auth.user.role !== "admin") return err("Forbidden", 403);

  await db
    .update(posts)
    .set({ deleted_at: new Date().toISOString() })
    .where(eq(posts.id, id));

  return ok({ deleted: true });
}
