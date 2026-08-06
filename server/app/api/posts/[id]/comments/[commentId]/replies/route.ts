import { NextRequest } from "next/server";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, comments, comment_replies } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const createSchema = z.object({
  body: z.string().min(1).max(1000),
  mention_id: z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { commentId } = await params;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  const [comment] = await db.select({ id: comments.id }).from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!comment) return err("Comment not found", 404);

  const rows = await db
    .select({
      id: comment_replies.id,
      body: comment_replies.body,
      like_count: comment_replies.like_count,
      created_at: comment_replies.created_at,
      updated_at: comment_replies.updated_at,
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
    .limit(limit);

  return ok({
    replies: rows.map((r) => ({
      id: r.id,
      body: r.body,
      like_count: r.like_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
      author: {
        id: r.author_id,
        name: r.author_display_name ?? r.author_name,
        display_name: r.author_display_name ?? r.author_name,
        displayName: r.author_display_name ?? r.author_name,
        username: r.author_username,
        avatar_url: r.author_avatar,
        avatarUrl: r.author_avatar,
      },
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;

  const [comment] = await db.select({ id: comments.id }).from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!comment) return err("Comment not found", 404);

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;

  const replyId = generateId();
  await db.insert(comment_replies).values({
    id: replyId,
    comment_id: commentId,
    author_id: auth.user.userId,
    body: parsed.data.body,
    mention_id: parsed.data.mention_id ?? null,
  });
  await db.update(comments).set({ reply_count: sql`${comments.reply_count} + 1` }).where(eq(comments.id, commentId));

  const [row] = await db
    .select({
      id: comment_replies.id,
      body: comment_replies.body,
      like_count: comment_replies.like_count,
      created_at: comment_replies.created_at,
      updated_at: comment_replies.updated_at,
      author_id: users.id,
      author_name: users.full_name,
      author_display_name: profiles.display_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
    })
    .from(comment_replies)
    .innerJoin(users, eq(users.id, comment_replies.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comment_replies.author_id))
    .where(eq(comment_replies.id, replyId))
    .limit(1);

  return created({
    reply: {
      id: row!.id,
      body: row!.body,
      like_count: row!.like_count,
      created_at: row!.created_at,
      updated_at: row!.updated_at,
      author: {
        id: row!.author_id,
        name: row!.author_display_name ?? row!.author_name,
        display_name: row!.author_display_name ?? row!.author_name,
        displayName: row!.author_display_name ?? row!.author_name,
        username: row!.author_username,
        avatar_url: row!.author_avatar,
        avatarUrl: row!.author_avatar,
      },
    },
  });
}
