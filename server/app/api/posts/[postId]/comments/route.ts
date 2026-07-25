import { NextRequest } from "next/server";
import { eq, desc, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, users, profiles, posts } from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody, parseQuery } from "@/lib/api/validate";
import { ok, created, notFound } from "@/lib/api/response";
import { createCommentSchema, commentQuerySchema } from "@/schemas/comment";
import { generateId } from "@/lib/auth/codes";
import { signCommentRow } from "@/lib/api/media";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;
  const parsed = parseQuery(req.nextUrl.searchParams, commentQuerySchema);
  if (!parsed.success) return parsed.response;
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      is_pinned: comments.is_pinned,
      like_count: comments.like_count,
      reply_count: comments.reply_count,
      created_at: comments.created_at,
      updated_at: comments.updated_at,
      author_id: comments.author_id,
      author_username: users.username,
      author_display_name: profiles.display_name,
      author_avatar: profiles.avatar_url,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comments.author_id))
    .where(and(eq(comments.post_id, postId), isNull(comments.deleted_at)))
    .orderBy(desc(comments.is_pinned), desc(comments.created_at))
    .limit(limit)
    .offset(offset);

  const signed = await Promise.all(rows.map(signCommentRow));
  return ok({ comments: signed, page, limit });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select({ id: posts.id, comment_count: posts.comment_count })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return notFound("Post not found");

  const parsed = await parseBody(req, createCommentSchema);
  if (!parsed.success) return parsed.response;

  const commentId = generateId();
  await db.insert(comments).values({
    id: commentId,
    post_id: postId,
    author_id: auth.user.userId,
    body: parsed.data.body,
  });

  await db.update(posts).set({ comment_count: post.comment_count + 1 }).where(eq(posts.id, postId));

  return created({ id: commentId }, "Comment posted");
}
