import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
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

  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return notFound();
  if (post.creator_id !== auth.user.userId) return forbidden();
  if (post.status !== "draft") return err("Post is not a draft", 400);

  await db
    .update(posts)
    .set({ status: "published", published_at: new Date().toISOString() })
    .where(eq(posts.id, postId));

  return ok(null, "Post published");
}
