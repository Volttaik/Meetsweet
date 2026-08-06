import { NextRequest } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, posts, comments } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const patchSchema = z.object({
  body: z.string().min(1).max(1000),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, author_id: comments.author_id })
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return err("Comment not found", 404);
  if (comment.author_id !== auth.user.userId) return err("Forbidden", 403);

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;

  const now = new Date().toISOString();
  await db.update(comments).set({ body: parsed.data.body, updated_at: now }).where(eq(comments.id, commentId));

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
      author_display_name: profiles.display_name,
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id, commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, author_id: comments.author_id })
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return err("Comment not found", 404);
  if (comment.author_id !== auth.user.userId && auth.user.role !== "admin") return err("Forbidden", 403);

  await db.update(comments).set({ deleted_at: new Date().toISOString() }).where(eq(comments.id, commentId));
  await db.update(posts).set({ comment_count: sql`MAX(0, ${posts.comment_count} - 1)` }).where(eq(posts.id, id));

  return ok({ deleted: true });
}
