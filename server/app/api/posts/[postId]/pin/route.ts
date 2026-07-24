import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, notFound } from "@/lib/api/response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return notFound();
  if (post.creator_id !== auth.user.userId) return forbidden();

  await db.update(posts).set({ is_pinned: true }).where(eq(posts.id, postId));
  return ok(null, "Post pinned");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return notFound();
  if (post.creator_id !== auth.user.userId) return forbidden();

  await db.update(posts).set({ is_pinned: false }).where(eq(posts.id, postId));
  return ok(null, "Post unpinned");
}
