import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, media, post_views } from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, forbidden, notFound } from "@/lib/api/response";
import { updatePostSchema } from "@/schemas/post";
import { generateId } from "@/lib/auth/codes";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await optionalAuth(req);
  const { postId } = await params;

  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return notFound("Post not found");

  const postMedia = await db
    .select()
    .from(media)
    .where(eq(media.post_id, postId));

  // Record view
  if (auth) {
    await db.insert(post_views).values({
      id: generateId(),
      user_id: auth.userId,
      post_id: postId,
    }).onConflictDoNothing();

    await db
      .update(posts)
      .set({ view_count: post.view_count + 1 })
      .where(eq(posts.id, postId));
  }

  return ok({ ...post, media: postMedia });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select({ id: posts.id, creator_id: posts.creator_id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return notFound("Post not found");
  if (post.creator_id !== auth.user.userId) return forbidden();

  const parsed = await parseBody(req, updatePostSchema);
  if (!parsed.success) return parsed.response;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const body = parsed.data;
  if (body.caption !== undefined) update.caption = body.caption;
  if (body.visibility !== undefined) update.visibility = body.visibility;
  if (body.preview_duration !== undefined) update.preview_duration = body.preview_duration;
  if (body.expires_at !== undefined) update.expires_at = body.expires_at;

  await db.update(posts).set(update).where(eq(posts.id, postId));

  return ok(null, "Post updated");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select({ id: posts.id, creator_id: posts.creator_id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return notFound("Post not found");
  if (post.creator_id !== auth.user.userId && auth.user.role !== "admin") return forbidden();

  await db
    .update(posts)
    .set({ deleted_at: new Date().toISOString(), status: "deleted" })
    .where(eq(posts.id, postId));

  return ok(null, "Post deleted");
}
