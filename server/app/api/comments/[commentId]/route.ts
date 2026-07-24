import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, forbidden, notFound } from "@/lib/api/response";
import { updateCommentSchema } from "@/schemas/comment";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { commentId } = await params;

  const [comment] = await db.select().from(comments).where(and(eq(comments.id, commentId), isNull(comments.deleted_at))).limit(1);
  if (!comment) return notFound();
  if (comment.author_id !== auth.user.userId) return forbidden();

  const parsed = await parseBody(req, updateCommentSchema);
  if (!parsed.success) return parsed.response;

  await db.update(comments).set({ body: parsed.data.body, updated_at: new Date().toISOString() }).where(eq(comments.id, commentId));
  return ok(null, "Comment updated");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { commentId } = await params;

  const [comment] = await db.select().from(comments).where(and(eq(comments.id, commentId), isNull(comments.deleted_at))).limit(1);
  if (!comment) return notFound();
  if (comment.author_id !== auth.user.userId && auth.user.role !== "admin") return forbidden();

  await db.update(comments).set({ deleted_at: new Date().toISOString() }).where(eq(comments.id, commentId));

  const [post] = await db.select({ comment_count: posts.comment_count }).from(posts).where(eq(posts.id, comment.post_id)).limit(1);
  if (post) {
    await db.update(posts).set({ comment_count: Math.max(0, post.comment_count - 1) }).where(eq(posts.id, comment.post_id));
  }

  return ok(null, "Comment deleted");
}
