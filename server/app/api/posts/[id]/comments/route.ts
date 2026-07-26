import { NextRequest } from "next/server";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, posts, comments, comment_likes } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const createSchema = z.object({
  body: z.string().min(1).max(1000),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) return err("Post not found", 404);

  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      is_pinned: comments.is_pinned,
      like_count: comments.like_count,
      reply_count: comments.reply_count,
      created_at: comments.created_at,
      updated_at: comments.updated_at,
      author_id: users.id,
      author_name: users.full_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comments.author_id))
    .where(and(eq(comments.post_id, id), isNull(comments.deleted_at)))
    .orderBy(desc(comments.is_pinned), desc(comments.created_at))
    .limit(limit);

  let likedSet = new Set<string>();
  const authResult = await requireAuth(req);
  if (!("response" in authResult) && rows.length > 0) {
    const uid = authResult.user.userId;
    const commentIds = rows.map((r) => r.id);
    const liked = await db
      .select({ comment_id: comment_likes.comment_id })
      .from(comment_likes)
      .where(
        and(
          eq(comment_likes.user_id, uid),
          sql`${comment_likes.comment_id} IN (${sql.join(commentIds.map((cid) => sql`${cid}`), sql`, `)})`,
        ),
      );
    likedSet = new Set(liked.map((l) => l.comment_id).filter(Boolean) as string[]);
  }

  return ok({
    comments: rows.map((r) => ({
      id: r.id,
      body: r.body,
      is_pinned: r.is_pinned,
      like_count: r.like_count,
      reply_count: r.reply_count,
      liked_by_me: likedSet.has(r.id),
      created_at: r.created_at,
      updated_at: r.updated_at,
      author: {
        id: r.author_id,
        name: r.author_name,
        username: r.author_username,
        avatar_url: r.author_avatar,
      },
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) return err("Post not found", 404);

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;

  const commentId = generateId();
  await db.insert(comments).values({
    id: commentId,
    post_id: id,
    author_id: auth.user.userId,
    body: parsed.data.body,
  });
  await db.update(posts).set({ comment_count: sql`${posts.comment_count} + 1` }).where(eq(posts.id, id));

  const [row] = await db
    .select({
      id: comments.id,
      body: comments.body,
      is_pinned: comments.is_pinned,
      like_count: comments.like_count,
      reply_count: comments.reply_count,
      created_at: comments.created_at,
      updated_at: comments.updated_at,
      author_id: users.id,
      author_name: users.full_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comments.author_id))
    .where(eq(comments.id, commentId))
    .limit(1);

  return ok({
    comment: {
      id: row!.id,
      body: row!.body,
      is_pinned: row!.is_pinned,
      like_count: row!.like_count,
      reply_count: row!.reply_count,
      liked_by_me: false,
      created_at: row!.created_at,
      updated_at: row!.updated_at,
      author: {
        id: row!.author_id,
        name: row!.author_name,
        username: row!.author_username,
        avatar_url: row!.author_avatar,
      },
    },
  });
}
