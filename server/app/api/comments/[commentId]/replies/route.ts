import { NextRequest } from "next/server";
import { eq, asc, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { comment_replies, users, profiles, comments } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody, parseQuery } from "@/lib/api/validate";
import { ok, created, notFound } from "@/lib/api/response";
import { createReplySchema, commentQuerySchema } from "@/schemas/comment";
import { generateId } from "@/lib/auth/codes";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const { commentId } = await params;
  const parsed = parseQuery(req.nextUrl.searchParams, commentQuerySchema);
  if (!parsed.success) return parsed.response;
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 50;
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: comment_replies.id,
      body: comment_replies.body,
      like_count: comment_replies.like_count,
      created_at: comment_replies.created_at,
      author_id: comment_replies.author_id,
      mention_id: comment_replies.mention_id,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
    })
    .from(comment_replies)
    .leftJoin(users, eq(users.id, comment_replies.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comment_replies.author_id))
    .where(and(eq(comment_replies.comment_id, commentId), isNull(comment_replies.deleted_at)))
    .orderBy(asc(comment_replies.created_at))
    .limit(limit)
    .offset(offset);

  return ok({ replies: rows, page, limit });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { commentId } = await params;

  const [comment] = await db.select({ id: comments.id, reply_count: comments.reply_count }).from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!comment) return notFound("Comment not found");

  const parsed = await parseBody(req, createReplySchema);
  if (!parsed.success) return parsed.response;

  const replyId = generateId();
  await db.insert(comment_replies).values({
    id: replyId,
    comment_id: commentId,
    author_id: auth.user.userId,
    body: parsed.data.body,
    mention_id: parsed.data.mention_id,
  });

  await db.update(comments).set({ reply_count: comment.reply_count + 1 }).where(eq(comments.id, commentId));

  return created({ id: replyId }, "Reply posted");
}
