import { NextRequest } from "next/server";
import { eq, and, desc, avg, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, creator_reviews, subscriptions } from "@/lib/db/schema";
import { optionalAuth, requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const createSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().max(2000).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20)), 50);

  const condition = id.includes("-") && id.length > 20 ? eq(users.id, id) : eq(users.username, id);
  const [creator] = await db.select({ id: users.id }).from(users)
    .where(and(condition, eq(users.is_creator, true))).limit(1);
  if (!creator) return err("Creator not found", 404);

  const [reviews, stats] = await Promise.all([
    db.select({
      id: creator_reviews.id,
      reviewer_id: creator_reviews.reviewer_id,
      rating: creator_reviews.rating,
      body: creator_reviews.body,
      created_at: creator_reviews.created_at,
      reviewer_username: users.username,
      reviewer_display_name: profiles.display_name,
      reviewer_avatar_url: profiles.avatar_url,
    })
      .from(creator_reviews)
      .innerJoin(users, eq(users.id, creator_reviews.reviewer_id))
      .leftJoin(profiles, eq(profiles.user_id, creator_reviews.reviewer_id))
      .where(eq(creator_reviews.creator_id, creator.id))
      .orderBy(desc(creator_reviews.created_at))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ avg: avg(creator_reviews.rating), total: count() })
      .from(creator_reviews)
      .where(eq(creator_reviews.creator_id, creator.id))
      .then((r) => r[0] ?? { avg: null, total: 0 }),
  ]);

  return ok({
    reviews: reviews.map((r) => ({
      id: r.id,
      reviewer_id: r.reviewer_id,
      reviewer_username: r.reviewer_username,
      reviewer_display_name: r.reviewer_display_name ?? null,
      reviewer_avatar_url: r.reviewer_avatar_url ?? null,
      rating: r.rating,
      body: r.body ?? null,
      created_at: r.created_at,
    })),
    total: stats.total,
    average_rating: stats.avg ? Number(stats.avg) : null,
    page,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const condition = id.includes("-") && id.length > 20 ? eq(users.id, id) : eq(users.username, id);
  const [creator] = await db.select({ id: users.id }).from(users)
    .where(and(condition, eq(users.is_creator, true))).limit(1);
  if (!creator) return err("Creator not found", 404);
  if (creator.id === auth.user.userId) return err("You cannot review yourself", 400);

  // Must be subscribed to leave a review
  const [sub] = await db.select({ id: subscriptions.id }).from(subscriptions)
    .where(and(eq(subscriptions.subscriber_id, auth.user.userId), eq(subscriptions.creator_id, creator.id), eq(subscriptions.status, "active")))
    .limit(1);
  if (!sub) return err("Active subscription required to leave a review", 403, "SUBSCRIPTION_REQUIRED");

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;

  // Upsert — one review per user per creator
  const [existing] = await db.select({ id: creator_reviews.id }).from(creator_reviews)
    .where(and(eq(creator_reviews.creator_id, creator.id), eq(creator_reviews.reviewer_id, auth.user.userId)))
    .limit(1);

  let reviewId: string;
  if (existing) {
    reviewId = existing.id;
    await db.update(creator_reviews)
      .set({ rating: parsed.data.rating, body: parsed.data.body ?? null, updated_at: new Date().toISOString() })
      .where(eq(creator_reviews.id, existing.id));
  } else {
    reviewId = generateId();
    await db.insert(creator_reviews).values({
      id: reviewId,
      creator_id: creator.id,
      reviewer_id: auth.user.userId,
      rating: parsed.data.rating,
      body: parsed.data.body ?? null,
    });
  }

  return created({ review_id: reviewId, rating: parsed.data.rating });
}
