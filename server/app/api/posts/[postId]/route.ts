import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, media, post_views, users, profiles, post_likes, saved_posts, content_purchases } from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, forbidden, notFound } from "@/lib/api/response";
import { updatePostSchema } from "@/schemas/post";
import { generateId } from "@/lib/auth/codes";
import { resolveUrl } from "@/lib/services/r2";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await optionalAuth(req);
  const { postId } = await params;

  const [row] = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: profiles.is_verified_creator,
      caption: posts.caption,
      visibility: posts.visibility,
      status: posts.status,
      unlock_price: posts.unlock_price,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      save_count: posts.save_count,
      view_count: posts.view_count,
      is_pinned: posts.is_pinned,
      preview_duration: posts.preview_duration,
      published_at: posts.published_at,
      created_at: posts.created_at,
      updated_at: posts.updated_at,
    })
    .from(posts)
    .leftJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!row) return notFound("Post not found");

  const postMedia = await db
    .select({
      id: media.id,
      url: media.url,
      type: media.type,
      duration_secs: media.duration_seconds,
      file_size: media.size_bytes,
      width: media.width,
      height: media.height,
    })
    .from(media)
    .where(eq(media.post_id, postId))
    .orderBy(media.sort_order);

  // Sign media URLs
  const signedMedia = await Promise.all(
    postMedia.map(async (m) => ({ ...m, url: (await resolveUrl(m.url)) ?? m.url }))
  );

  let liked_by_me = false;
  let bookmarked_by_me = false;
  let purchased_by_me = false;

  if (auth) {
    const [like] = await db
      .select({ id: post_likes.id })
      .from(post_likes)
      .where(and(eq(post_likes.post_id, postId), eq(post_likes.user_id, auth.userId)))
      .limit(1);
    liked_by_me = !!like;

    const [saved] = await db
      .select({ id: saved_posts.id })
      .from(saved_posts)
      .where(and(eq(saved_posts.post_id, postId), eq(saved_posts.user_id, auth.userId)))
      .limit(1);
    bookmarked_by_me = !!saved;

    const [purchase] = await db
      .select({ id: content_purchases.id })
      .from(content_purchases)
      .where(
        and(
          eq(content_purchases.post_id, postId),
          eq(content_purchases.user_id, auth.userId)
        )
      )
      .limit(1);
    purchased_by_me = !!purchase || auth.userId === row.creator_id;

    await db
      .insert(post_views)
      .values({ id: generateId(), user_id: auth.userId, post_id: postId })
      .onConflictDoNothing();

    await db
      .update(posts)
      .set({ view_count: row.view_count + 1 })
      .where(eq(posts.id, postId));
  }

  return ok({
    ...row,
    creator_avatar: await resolveUrl(row.creator_avatar),
    liked_by_me,
    bookmarked_by_me,
    purchased_by_me,
    media: signedMedia,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select({ id: posts.id, creator_id: posts.creator_id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return notFound("Post not found");
  if (post.creator_id !== auth.user.userId) return forbidden();

  const parsed = await parseBody(req, updatePostSchema);
  if (!parsed.success) return parsed.response;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const body = parsed.data;
  if (body.caption !== undefined) update.caption = body.caption;
  if (body.visibility !== undefined) update.visibility = body.visibility;
  if (body.preview_duration !== undefined) update.preview_duration = body.preview_duration;
  if (body.expires_at !== undefined) update.expires_at = body.expires_at;

  await db.update(posts).set(update).where(eq(posts.id, postId));
  return ok(null, "Post updated");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select({ id: posts.id, creator_id: posts.creator_id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return notFound("Post not found");
  if (post.creator_id !== auth.user.userId && auth.user.role !== "admin") return forbidden();

  await db
    .update(posts)
    .set({ deleted_at: new Date().toISOString(), status: "deleted" })
    .where(eq(posts.id, postId));

  return ok(null, "Post deleted");
}
