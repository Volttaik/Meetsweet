import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { notifySubscribersOfNewPost } from "@/lib/services/push";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      status: posts.status,
      content_type: posts.content_type,
      title: posts.title,
    })
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return err("Post not found", 404);
  if (post.creator_id !== auth.user.userId) return err("Forbidden", 403);
  if (post.status === "published") return ok({ published: true });

  const now = new Date().toISOString();
  await db
    .update(posts)
    .set({ status: "published", published_at: now, updated_at: now })
    .where(eq(posts.id, id));

  void notifySubscribersOfNewPost({
    creatorId: post.creator_id,
    postId: post.id,
    contentType: post.content_type ?? "post",
    title: post.title,
  });

  return ok({ published: true });
}
