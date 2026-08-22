import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, post_likes } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { sendPushToUser, getActorUsername, createNotification } from "@/lib/services/push";

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
      like_count: posts.like_count,
      creator_id: posts.creator_id,
      content_type: posts.content_type,
      title: posts.title,
      caption: posts.caption,
    })
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

    // Notify post creator (skip if creator liked their own post). The in-app
    // notification row is gated by their Likes preference — when OFF, no event
    // is written and no push is sent (the push below is already gated). The
    // context includes the post title so the notification is meaningful.
    if (post.creator_id && post.creator_id !== auth.user.userId) {
      const postTitle = (post.title ?? post.caption ?? "").trim();
      const likeContext = postTitle
        ? `liked your post "${postTitle.slice(0, 60)}"`
        : "liked your post";

      await createNotification(post.creator_id, "notif_likes", {
        actor_id: auth.user.userId,
        type: "like",
        entity_type: "post",
        entity_id: id,
        body: likeContext,
      });

      // Fire push in background — don't await so it never delays the response
      getActorUsername(auth.user.userId).then((actor) =>
        sendPushToUser(post.creator_id!, {
          title: "New Like",
          body: `${actor} ${likeContext}`,
          data: {
            type: "like",
            post_id: id,
            actor_id: auth.user.userId,
            content_type: post.content_type ?? "post",
            actor_username: actor.replace(/^@/, ""),
          },
        }, "notif_likes"),
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
