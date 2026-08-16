import { NextRequest } from "next/server";
import { eq, and, count, isNull, avg, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, posts, follows, subscriptions, creator_reviews } from "@/lib/db/schema";
import { ok, err } from "@/lib/api/response";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const condition = id.includes("-") && id.length > 20 ? eq(users.id, id) : eq(users.username, id);
  const [creator] = await db.select({ id: users.id }).from(users)
    .where(and(condition, eq(users.is_creator, true))).limit(1);
  if (!creator) return err("Creator not found", 404);

  const [followerCount, subscriberCount, postCount, videoCount, shortCount, totalLikes, reviewStats] =
    await Promise.all([
      db.select({ n: count() }).from(follows).where(eq(follows.following_id, creator.id)).then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(subscriptions)
        .where(and(eq(subscriptions.creator_id, creator.id), eq(subscriptions.status, "active")))
        .then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(posts)
        .where(and(eq(posts.creator_id, creator.id), eq(posts.status, "published"), isNull(posts.deleted_at), eq(posts.content_type, "post")))
        .then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(posts)
        .where(and(eq(posts.creator_id, creator.id), eq(posts.status, "published"), isNull(posts.deleted_at), eq(posts.content_type, "video")))
        .then((r) => r[0]?.n ?? 0),
      db.select({ n: count() }).from(posts)
        .where(and(eq(posts.creator_id, creator.id), eq(posts.status, "published"), isNull(posts.deleted_at), eq(posts.content_type, "short")))
        .then((r) => r[0]?.n ?? 0),
      // Canonical like count: SUM(posts.like_count) over published, non-deleted
      // posts — the same source the dashboard (`creator/statistics`) uses. The
      // raw post_likes row count can disagree (it includes deleted/draft posts
      // and drifts from the denormalized counter), which caused "works here but
      // not there" like totals.
      db.select({ total: sum(posts.like_count) }).from(posts)
        .where(and(
          eq(posts.creator_id, creator.id),
          eq(posts.status, "published"),
          isNull(posts.deleted_at),
        ))
        .then((r) => Number(r[0]?.total ?? 0)),
      db.select({ avg: avg(creator_reviews.rating), total: count() }).from(creator_reviews)
        .where(eq(creator_reviews.creator_id, creator.id))
        .then((r) => r[0] ?? { avg: null, total: 0 }),
    ]);

  return ok({
    follower_count: followerCount,
    subscriber_count: subscriberCount,
    post_count: postCount,
    video_count: videoCount,
    short_count: shortCount,
    total_likes: totalLikes,
    average_rating: reviewStats.avg ? Number(reviewStats.avg) : null,
    review_count: reviewStats.total,
  });
}
