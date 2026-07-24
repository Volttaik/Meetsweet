import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, saved_posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, notFound } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select({ id: posts.id, save_count: posts.save_count })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return notFound();

  // Only increment count if the row didn't already exist
  const [existing] = await db
    .select({ id: saved_posts.id })
    .from(saved_posts)
    .where(and(eq(saved_posts.post_id, postId), eq(saved_posts.user_id, auth.user.userId)))
    .limit(1);

  if (!existing) {
    await db.insert(saved_posts).values({
      id: generateId(),
      user_id: auth.user.userId,
      post_id: postId,
    });
    await db
      .update(posts)
      .set({ save_count: post.save_count + 1 })
      .where(eq(posts.id, postId));
  }

  return ok(null, "Saved");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select({ id: posts.id, save_count: posts.save_count })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return notFound();

  // Only decrement count if a row was actually deleted
  const [existing] = await db
    .select({ id: saved_posts.id })
    .from(saved_posts)
    .where(and(eq(saved_posts.post_id, postId), eq(saved_posts.user_id, auth.user.userId)))
    .limit(1);

  if (existing) {
    await db.delete(saved_posts).where(eq(saved_posts.id, existing.id));
    await db
      .update(posts)
      .set({ save_count: Math.max(0, post.save_count - 1) })
      .where(eq(posts.id, postId));
  }

  return ok(null, "Unsaved");
}
