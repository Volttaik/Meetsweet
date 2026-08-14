import { NextRequest } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { comment_rooms, comments, posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id, commentId } = await params;

  const [comment] = await db
    .select({ id: comments.id, author_id: comments.author_id })
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.post_id, id), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return err("Comment not found", 404);
  if (comment.author_id !== auth.user.userId) return err("Forbidden", 403);

  const parsed = await parseBody(req, z.object({ body: z.string().min(1).max(1000) }));
  if (!parsed.success) return parsed.response;

  await db
    .update(comments)
    .set({ body: parsed.data.body, updated_at: new Date().toISOString() })
    .where(eq(comments.id, commentId));

  return ok({ updated: true });
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
    .where(and(eq(comments.id, commentId), eq(comments.post_id, id), isNull(comments.deleted_at)))
    .limit(1);

  if (!comment) return err("Comment not found", 404);
  if (comment.author_id !== auth.user.userId && auth.user.role !== "admin") return err("Forbidden", 403);

  await db.update(comments).set({ deleted_at: new Date().toISOString() }).where(eq(comments.id, commentId));
  await db.update(posts).set({ comment_count: sql`MAX(0, ${posts.comment_count} - 1)` }).where(eq(posts.id, id));
  await db
    .update(comment_rooms)
    .set({ comment_count: sql`MAX(0, ${comment_rooms.comment_count} - 1)`, updated_at: new Date().toISOString() })
    .where(eq(comment_rooms.post_id, id));

  return ok({ deleted: true });
}
