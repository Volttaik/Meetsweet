import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, archives } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, notFound } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

// Mobile app sends PUT — accept both
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  return POST(req, { params });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db.select().from(posts).where(and(eq(posts.id, postId), isNull(posts.deleted_at))).limit(1);
  if (!post) return notFound();
  if (post.creator_id !== auth.user.userId) return forbidden();

  await Promise.all([
    db.update(posts).set({ status: "archived", updated_at: new Date().toISOString() }).where(eq(posts.id, postId)),
    db.insert(archives).values({ id: generateId(), post_id: postId, creator_id: auth.user.userId }),
  ]);

  return ok(null, "Post archived");
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

  await db.update(posts).set({ status: "published", updated_at: new Date().toISOString() }).where(eq(posts.id, postId));

  return ok(null, "Post restored from archive");
}
