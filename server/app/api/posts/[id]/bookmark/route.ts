import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, saved_posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) return err("Post not found", 404);

  const [existing] = await db
    .select({ id: saved_posts.id })
    .from(saved_posts)
    .where(and(eq(saved_posts.user_id, auth.user.userId), eq(saved_posts.post_id, id)))
    .limit(1);

  if (!existing) {
    await db.insert(saved_posts).values({ id: generateId(), user_id: auth.user.userId, post_id: id });
    await db.update(posts).set({ save_count: sql`${posts.save_count} + 1` }).where(eq(posts.id, id));
  }

  return ok({ bookmarked: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) return err("Post not found", 404);

  const [existing] = await db
    .select({ id: saved_posts.id })
    .from(saved_posts)
    .where(and(eq(saved_posts.user_id, auth.user.userId), eq(saved_posts.post_id, id)))
    .limit(1);

  if (existing) {
    await db.delete(saved_posts).where(eq(saved_posts.id, existing.id));
    await db.update(posts).set({ save_count: sql`MAX(0, ${posts.save_count} - 1)` }).where(eq(posts.id, id));
  }

  return ok({ bookmarked: false });
}
