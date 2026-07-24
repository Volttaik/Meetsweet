import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, notFound, err } from "@/lib/api/response";

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
  if (post.status !== "deleted" && !post.deleted_at) return err("Post is not deleted", 400);

  await db
    .update(posts)
    .set({ status: "draft", deleted_at: null })
    .where(eq(posts.id, postId));

  return ok(null, "Post restored");
}
