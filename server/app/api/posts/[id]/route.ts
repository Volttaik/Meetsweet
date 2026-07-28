import { NextRequest } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, posts, media, post_likes, saved_posts, post_unlocks } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const patchSchema = z.object({
  caption: z.string().max(2200).nullable().optional(),
  visibility: z.enum(["public", "subscribers", "draft"]).optional(),
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
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(and(eq(posts.id, id), isNull(posts.deleted_at)))
    .limit(1);

  if (!row) return err("Post not found", 404);

  const postMedia = await db.select().from(media).where(eq(media.post_id, id));

  let likedByMe = false;
  let bookmarkedByMe = false;
  let unlockedByMe = false;

  const authResult = await requireAuth(req);
  if (!("response" in authResult)) {
    const uid = authResult.user.userId;
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

    const [unlocked] = await db
      .select({ id: post_unlocks.id })
      .from(post_unlocks)
      .where(and(eq(post_unlocks.user_id, uid), eq(post_unlocks.post_id, id)))
      .limit(1);
    unlockedByMe = !!unlocked;
  }

  const isLocked = (row.unlock_price ?? 0) > 0
    && row.creator_id !== (authResult && !("response" in authResult) ? authResult.user.userId : null)
    && !unlockedByMe;

  return ok({
    ...row,
    // content_type comes from the DB select above — no override needed
    is_locked: isLocked,
    unlocked_by_me: !isLocked,
    liked_by_me: likedByMe,
    bookmarked_by_me: bookmarkedByMe,
    media: postMedia.map((m) => isLocked
      ? {
          url: null,
          type: m.type,
          thumbnail_url: null,
          duration_secs: m.duration_seconds,
          file_size: m.size_bytes,
          width: m.width,
          height: m.height,
          is_locked: true,
        }
      : {
          url: m.url,
          type: m.type,
          thumbnail_url: m.thumbnail_url ?? null,
          duration_secs: m.duration_seconds,
          file_size: m.size_bytes,
          width: m.width,
          height: m.height,
          is_locked: false,
        }),
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

  await db
    .update(posts)
    .set({ ...parsed.data, updated_at: new Date().toISOString() })
    .where(eq(posts.id, id));

  const [updated] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return ok({ post: updated });
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
