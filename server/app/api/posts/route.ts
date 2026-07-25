import { NextRequest } from "next/server";
import { eq, desc, and, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, users, profiles, media, saved_posts } from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody, parseQuery } from "@/lib/api/validate";
import { ok, created, unauthorized } from "@/lib/api/response";
import { createPostSchema, postQuerySchema } from "@/schemas/post";
import { generateId } from "@/lib/auth/codes";

export async function GET(req: NextRequest) {
  const parsed = parseQuery(req.nextUrl.searchParams, postQuerySchema);
  if (!parsed.success) return parsed.response;
  const page = Number(parsed.data.page ?? 1);
  const limit = Number(parsed.data.limit ?? 20);
  const offset = (page - 1) * limit;
  const bookmarked = parsed.data.bookmarked;

  // Bookmarked feed requires authentication
  if (bookmarked) {
    const auth = await requireAuth(req);
    if ("response" in auth) return auth.response;

    const bookmarkedPostIds = await db
      .select({ post_id: saved_posts.post_id })
      .from(saved_posts)
      .where(eq(saved_posts.user_id, auth.user.userId));

    if (!bookmarkedPostIds.length) return ok({ posts: [], page, limit });

    const ids = bookmarkedPostIds.map((b) => b.post_id);

    const rows = await db
      .select({
        id: posts.id,
        caption: posts.caption,
        visibility: posts.visibility,
        status: posts.status,
        is_pinned: posts.is_pinned,
        preview_duration: posts.preview_duration,
        expires_at: posts.expires_at,
        published_at: posts.published_at,
        view_count: posts.view_count,
        like_count: posts.like_count,
        comment_count: posts.comment_count,
        save_count: posts.save_count,
        created_at: posts.created_at,
        creator_id: posts.creator_id,
        creator_username: users.username,
        creator_display_name: profiles.display_name,
        creator_avatar: profiles.avatar_url,
        creator_is_verified: profiles.is_verified_creator,
      })
      .from(posts)
      .leftJoin(users, eq(users.id, posts.creator_id))
      .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
      .where(and(inArray(posts.id, ids), isNull(posts.deleted_at)))
      .orderBy(desc(posts.published_at))
      .limit(limit)
      .offset(offset);

    return ok({ posts: rows, page, limit });
  }

  await optionalAuth(req);

  const rows = await db
    .select({
      id: posts.id,
      caption: posts.caption,
      visibility: posts.visibility,
      status: posts.status,
      is_pinned: posts.is_pinned,
      preview_duration: posts.preview_duration,
      expires_at: posts.expires_at,
      published_at: posts.published_at,
      view_count: posts.view_count,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      save_count: posts.save_count,
      created_at: posts.created_at,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: profiles.is_verified_creator,
    })
    .from(posts)
    .leftJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(and(eq(posts.status, "published"), isNull(posts.deleted_at)))
    .orderBy(desc(posts.published_at))
    .limit(limit)
    .offset(offset);

  return ok({ posts: rows, page, limit });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, createPostSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const postId = generateId();
  const now = new Date().toISOString();

  await db.insert(posts).values({
    id: postId,
    creator_id: auth.user.userId,
    caption: body.caption,
    visibility: body.visibility,
    status: body.status,
    preview_duration: body.preview_duration,
    expires_at: body.expires_at,
    published_at: body.status === "published" ? now : null,
  });

  // Attach only the explicitly requested media IDs owned by this user
  if (body.media_ids?.length) {
    await db
      .update(media)
      .set({ post_id: postId })
      .where(
        and(
          eq(media.uploader_id, auth.user.userId),
          isNull(media.post_id),
          inArray(media.id, body.media_ids)
        )
      );
  }

  return created({ id: postId }, "Post created");
}
