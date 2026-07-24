import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, notFound } from "@/lib/api/response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { commentId } = await params;

  const [comment] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!comment) return notFound();

  // Only post creator can pin
  const [post] = await db.select({ creator_id: posts.creator_id }).from(posts).where(eq(posts.id, comment.post_id)).limit(1);
  if (!post || post.creator_id !== auth.user.userId) return forbidden();

  await db.update(comments).set({ is_pinned: true }).where(eq(comments.id, commentId));
  return ok(null, "Comment pinned");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { commentId } = await params;

  const [comment] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!comment) return notFound();

  const [post] = await db.select({ creator_id: posts.creator_id }).from(posts).where(eq(posts.id, comment.post_id)).limit(1);
  if (!post || post.creator_id !== auth.user.userId) return forbidden();

  await db.update(comments).set({ is_pinned: false }).where(eq(comments.id, commentId));
  return ok(null, "Comment unpinned");
}
