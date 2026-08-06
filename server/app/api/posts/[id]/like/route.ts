import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, post_likes, notifications } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { sendPushToUser, getActorUsername } from "@/lib/services/push";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db
    .select({ id: posts.id, like_count: posts.like_count, creator_id: posts.creator_id })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!post) return err("Post not found", 404);

  const [existing] = await db
    .select({ id: post_likes.id })
    .from(post_likes)
    .where(and(eq(post_likes.user_id, auth.user.userId), eq(post_likes.post_id, id)))
    .limit(1);

  if (!existing) {
    await db.insert(post_likes).values({ id: generateId(), user_id: auth.user.userId, post_id: id });
    await db.update(posts).set({ like_count: sql`${posts.like_count} + 1` }).where(eq(posts.id, id));

    // Notify post creator (skip if creator liked their own post)
    if (post.creator_id && post.creator_id !== auth.user.userId) {
      const notifId = generateId();
      await db.insert(notifications).values({
        id: notifId,
        user_id: post.creator_id,
        actor_id: auth.user.userId,
        type: "like",
        entity_type: "post",
        entity_id: id,
        body: "liked your post",
      }).catch(() => {});

      // Fire push in background — don't await so it never delays the response
      getActorUsername(auth.user.userId).then((actor) =>
        sendPushToUser(post.creator_id!, {
          title: "New Like ❤️",
          body: `${actor} liked your post`,
          data: {
            type: "like",
            post_id: id,
            actor_id: auth.user.userId,
            content_type: "post",
          },
        }),
      );
    }
  }

  const [updated] = await db.select({ like_count: posts.like_count }).from(posts).where(eq(posts.id, id)).limit(1);
  return ok({ liked: true, like_count: updated?.like_count ?? 0 });
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
    .select({ id: post_likes.id })
    .from(post_likes)
    .where(and(eq(post_likes.user_id, auth.user.userId), eq(post_likes.post_id, id)))
    .limit(1);

  if (existing) {
    await db.delete(post_likes).where(eq(post_likes.id, existing.id));
    await db.update(posts).set({ like_count: sql`MAX(0, ${posts.like_count} - 1)` }).where(eq(posts.id, id));
  }

  const [updated] = await db.select({ like_count: posts.like_count }).from(posts).where(eq(posts.id, id)).limit(1);
  return ok({ liked: false, like_count: updated?.like_count ?? 0 });
}
