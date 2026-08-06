import { NextRequest } from "next/server";
import { eq, and, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, comments, comment_replies } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

function formatReply(r: Record<string, unknown>, commentId: string) {
  const name = (r.author_display_name ?? r.author_name) as string | null;
  return {
    id: r.id,
    body: r.body,
    created_at: r.created_at,
    updated_at: r.updated_at,
    like_count: r.like_count ?? 0,
    reply_count: 0,
    parent_id: commentId,
    liked_by_me: false,
    author_id: r.author_id,
    author_display_name: name,
    author_username: r.author_username,
    author_avatar: r.author_avatar,
    author: {
      id: r.author_id,
      name,
      display_name: name,
      displayName: name,
      username: r.author_username,
      avatar_url: r.author_avatar,
      avatarUrl: r.author_avatar,
    },
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> },
) {
  const { commentId } = await params;

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);
  const offset = (page - 1) * limit;

  // Check comment exists
  const [comment] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return err("Comment not found", 404);

  const rows = await db
    .select({
      id: comment_replies.id,
      body: comment_replies.body,
      created_at: comment_replies.created_at,
      updated_at: comment_replies.updated_at,
      like_count: comment_replies.like_count,
      author_id: users.id,
      author_name: users.full_name,
      author_display_name: profiles.display_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
    })
    .from(comment_replies)
    .innerJoin(users, eq(users.id, comment_replies.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comment_replies.author_id))
    .where(and(eq(comment_replies.comment_id, commentId), isNull(comment_replies.deleted_at)))
    .orderBy(desc(comment_replies.created_at))
    .limit(limit)
    .offset(offset);

  return ok({ replies: rows.map((r) => formatReply(r as Record<string, unknown>, commentId)) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, reply_count: comments.reply_count })
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return err("Comment not found", 404);

  const parsed = await parseBody(req, z.object({ body: z.string().min(1).max(2000) }));
  if (!parsed.success) return parsed.response;

  const replyId = generateId();
  await db.insert(comment_replies).values({
    id: replyId,
    comment_id: commentId,
    author_id: auth.user.userId,
    body: parsed.data.body,
  });

  // Increment reply count on parent comment
  await db
    .update(comments)
    .set({ reply_count: (comment.reply_count ?? 0) + 1 })
    .where(eq(comments.id, commentId));

  return created({ id: replyId });
}
