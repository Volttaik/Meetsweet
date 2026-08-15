import { NextRequest } from "next/server";
import { eq, and, desc, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, profiles, posts, media, post_likes, saved_posts, post_categories, subscriptions, comment_rooms } from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { canViewContent } from "@/lib/services/content";
import { notifySubscribersOfNewPost } from "@/lib/services/push";

const createSchema = z.object({
  caption: z.string().max(2200).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  // The mobile app routes ALL content types through this endpoint.
  // content_type drives which feed the post appears in:
  //   "post"  → Posts/image feed
  //   "video" → Long-form video feed
  //   "short" → Shorts feed
  //   "album" → Albums (legacy path; prefer POST /api/albums for full album features)
  content_type: z.enum(["post", "video", "short", "album"]).default("post"),
  visibility: z.enum(["public", "subscribers", "draft"]).default("public"),
  // "free" = public/explore, "subscriber" = any subscriber, "subscriber_plus" = exclusive tier
  tier: z.enum(["free", "subscriber", "subscriber_plus"]).nullable().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  preview_duration: z.number().int().min(1).nullable().optional(),
  expires_at: z.string().optional(),
  // media_ids: IDs of pre-uploaded media records (from POST /api/media)
  media_ids: z.array(z.string()).max(10).optional(),
  // media: inline media objects
  media: z
    .array(
      z.object({
        url: z.string().url(),
        blob_path: z.string().min(1),
        type: z.enum(["image", "video"]),
        mime_type: z.string().optional(),
        size_bytes: z.number().int().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        duration_seconds: z.number().optional(),
        thumbnail_url: z.string().url().nullable().optional(),
      }),
    )
    .max(10)
    .optional(),
  // categories: array of category ID strings
  categories: z.array(z.string()).optional(),
});

function mediaShape(m: Record<string, unknown>) {
  return {
    id: m.id,
    url: m.url,
    type: m.type,
    thumbnail_url: (m.thumbnail_url as string | null) ?? null,
    duration_secs: m.duration_seconds ?? null,
    width: m.width ?? null,
    height: m.height ?? null,
    file_size: m.size_bytes ?? null,
  };
}

function postRow(
  p: Record<string, unknown>,
  mediaItems: Record<string, unknown>[],
  liked: boolean,
  bookmarked: boolean,
  isLocked: boolean,
) {
  return {
    id: p.id,
    comment_room_id: p.id,
    content_type: p.content_type ?? "post",
    creator_id: p.creator_id,
    creator_username: p.creator_username,
    creator_display_name: p.creator_display_name,
    creator_avatar: p.creator_avatar,
    creator_is_verified: p.creator_is_verified,
    caption: p.caption ?? null,
    title: p.title ?? null,
    description: p.description ?? null,
    visibility: p.visibility,
    status: p.status,
    is_pinned: p.is_pinned,
    tier: p.tier ?? null,
    thumbnail_url: p.thumbnail_url ?? null,
    tags: p.tags ? JSON.parse(p.tags as string) : [],
    preview_duration: p.preview_duration,
    like_count: p.like_count,
    comment_count: p.comment_count,
    save_count: p.save_count,
    view_count: p.view_count,
    published_at: p.published_at,
    created_at: p.created_at,
    updated_at: p.updated_at,
    liked_by_me: liked,
    bookmarked_by_me: bookmarked,
    is_locked: isLocked,
    isLocked,
    media: isLocked ? [] : mediaItems.map(mediaShape),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const pathname = req.nextUrl.pathname;
  // /posts/feed and /posts/bookmarks are static route aliases (see their route.ts
  // re-exports). Detect them from the path so the same handler can serve both.
  const bookmarked =
    searchParams.get("bookmarked") === "true" || pathname.endsWith("/posts/bookmarks");
  const creatorId = searchParams.get("creator_id") ?? searchParams.get("creatorId");
  const cursor = searchParams.get("cursor");
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);
  // feed=home: authenticated home feed — shows subscribed creators' content
  const feedMode =
    searchParams.get("feed") ?? (pathname.endsWith("/posts/feed") ? "home" : null);
  // Optional content_type filter: short | video | post | album
  // When omitted, ALL published content types are returned so the mobile can
  // filter client-side (video feed, posts feed etc. all query this endpoint).
  const contentTypeFilter = searchParams.get("content_type") as
    | "post" | "video" | "short" | "album" | null;

  let userId: string | null = null;
  const authResult = await optionalAuth(req);
  if (authResult?.userId) userId = authResult.userId;

  if (bookmarked || feedMode === "home") {
    if (!userId) {
      const authReq = await requireAuth(req);
      if ("response" in authReq) return authReq.response;
    }
  }

  // ── Home feed: subscription-aware query ─────────────────────────────────
  // Returns free + subscriber posts only from creators the user subscribes to,
  // respecting tier gating (subscriber vs subscriber_plus).
  if (feedMode === "home" && userId) {
    const [allSubs, plusSubs] = await Promise.all([
      db
        .select({ creator_id: subscriptions.creator_id })
        .from(subscriptions)
        .where(and(eq(subscriptions.subscriber_id, userId), eq(subscriptions.status, "active"))),
      db
        .select({ creator_id: subscriptions.creator_id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.subscriber_id, userId),
            eq(subscriptions.status, "active"),
            eq(subscriptions.tier, "subscriber_plus"),
          ),
        ),
    ]);

    const subscribedIds = allSubs.map((s) => s.creator_id);
    const plusIds = plusSubs.map((s) => s.creator_id);

    const subIdList = sql.join(subscribedIds.map((id) => sql`${id}`), sql`, `);
    const plusIdList = plusIds.length > 0
      ? sql.join(plusIds.map((id) => sql`${id}`), sql`, `)
      : sql`NULL`;

    // Tier-aware filter:
    //   free (or null tier) posts from any subscribed creator
    //   subscriber posts from any subscribed creator
    //   subscriber_plus posts only from subscriber_plus subscriptions
    // Own posts always pass — a creator must never have to subscribe to
    // themselves to see their own content in their Home feed.
    const tierCondition = or(
      or(eq(posts.tier, "free"), isNull(posts.tier)),
      eq(posts.tier, "subscriber"),
      plusIds.length > 0
        ? and(eq(posts.tier, "subscriber_plus"), sql`${posts.creator_id} IN (${plusIdList})`)
        : sql`0`,
    );

    // Feed sources: the user's own published content + posts from creators
    // the user actively subscribes to. The user's own content must never be
    // gated behind subscribing to themselves.
    const creatorCond =
      subscribedIds.length > 0
        ? or(eq(posts.creator_id, userId), sql`${posts.creator_id} IN (${subIdList})`)
        : eq(posts.creator_id, userId);

    let homeCond = and(
      isNull(posts.deleted_at),
      eq(posts.status, "published"),
      sql`${posts.visibility} != 'draft'`,
      creatorCond,
      // Own posts bypass the tier gate; subscribed creators' posts are tier-gated.
      or(eq(posts.creator_id, userId), tierCondition),
      contentTypeFilter
        ? eq(posts.content_type, contentTypeFilter)
        : sql`${posts.content_type} IN ('post', 'video', 'album')`,
    );

    if (cursor) {
      const sepIdx = cursor.lastIndexOf("__");
      if (sepIdx !== -1) {
        const cursorTs = cursor.slice(0, sepIdx);
        const cursorId = cursor.slice(sepIdx + 2);
        homeCond = and(
          homeCond,
          sql`(${posts.published_at} < ${cursorTs} OR (${posts.published_at} = ${cursorTs} AND ${posts.id} < ${cursorId}))`,
        );
      } else {
        homeCond = and(homeCond, sql`${posts.published_at} < ${cursor}`);
      }
    }

    const homeRows = await db
      .select({
        id: posts.id,
        content_type: posts.content_type,
        creator_id: posts.creator_id,
        creator_username: users.username,
        creator_display_name: profiles.display_name,
        creator_avatar: profiles.avatar_url,
        creator_is_verified: users.is_verified,
        caption: posts.caption,
        title: posts.title,
        description: posts.description,
        thumbnail_url: posts.thumbnail_url,
        tier: posts.tier,
        tags: posts.tags,
        visibility: posts.visibility,
        status: posts.status,
        is_pinned: posts.is_pinned,
        preview_duration: posts.preview_duration,
        like_count: posts.like_count,
        comment_count: posts.comment_count,
        save_count: posts.save_count,
        view_count: posts.view_count,
        published_at: posts.published_at,
        created_at: posts.created_at,
        updated_at: posts.updated_at,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.creator_id))
      .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
      .where(homeCond)
      .orderBy(desc(posts.published_at), desc(posts.id))
      .limit(limit + 1)
      .offset(cursor ? 0 : (page - 1) * limit);

    const homeHasMore = homeRows.length > limit;
    const homeItems = homeHasMore ? homeRows.slice(0, limit) : homeRows;
    const homePostIds = homeItems.map((p) => p.id);

    if (homePostIds.length === 0) {
      return ok({ posts: [], next_cursor: null, nextCursor: null, page, limit });
    }

    const homeMedia = await db
      .select()
      .from(media)
      .where(sql`${media.post_id} IN (${sql.join(homePostIds.map((id) => sql`${id}`), sql`, `)})`);

    const homeMediaByPost = homeMedia.reduce((acc, m) => {
      if (!m.post_id) return acc;
      if (!acc[m.post_id]) acc[m.post_id] = [];
      acc[m.post_id].push(m as Record<string, unknown>);
      return acc;
    }, {} as Record<string, Record<string, unknown>[]>);

    const [homeLiked, homeSaved] = await Promise.all([
      db.select({ post_id: post_likes.post_id }).from(post_likes)
        .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${sql.join(homePostIds.map((id) => sql`${id}`), sql`, `)})`)),
      db.select({ post_id: saved_posts.post_id }).from(saved_posts)
        .where(and(eq(saved_posts.user_id, userId), sql`${saved_posts.post_id} IN (${sql.join(homePostIds.map((id) => sql`${id}`), sql`, `)})`)),
    ]);
    const homeLikedSet = new Set(homeLiked.map((l) => l.post_id));
    const homeSavedSet = new Set(homeSaved.map((s) => s.post_id));

    // Build subscription map for is_locked calculation
    const homeSubMap = new Map<string, string | null>(
      allSubs.map((s) => [
        s.creator_id,
        plusIds.includes(s.creator_id) ? "subscriber_plus" : "subscriber",
      ]),
    );

    const homeResult = homeItems.map((p) => {
      const isOwner = userId === (p.creator_id as string);
      const isSubscribed = homeSubMap.has(p.creator_id as string);
      const subTier = homeSubMap.get(p.creator_id as string) ?? null;
      const isLocked = !canViewContent(p.visibility as string, p.tier as string | null, isSubscribed, subTier, isOwner);
      return postRow(p as Record<string, unknown>, homeMediaByPost[p.id] ?? [], homeLikedSet.has(p.id), homeSavedSet.has(p.id), isLocked);
    });

    const homeLastItem = homeItems[homeItems.length - 1];
    const homeNextCursor = homeHasMore && homeLastItem
      ? `${homeLastItem.published_at ?? homeLastItem.created_at}__${homeLastItem.id}`
      : null;

    return ok({ posts: homeResult, next_cursor: homeNextCursor, nextCursor: homeNextCursor, page, limit });
  }

  const baseSelect = db
    .select({
      id: posts.id,
      content_type: posts.content_type,
      creator_id: posts.creator_id,
      creator_username: users.username,
      creator_display_name: profiles.display_name,
      creator_avatar: profiles.avatar_url,
      creator_is_verified: users.is_verified,
      caption: posts.caption,
      title: posts.title,
      description: posts.description,
      thumbnail_url: posts.thumbnail_url,
      tier: posts.tier,
      tags: posts.tags,
      visibility: posts.visibility,
      status: posts.status,
      is_pinned: posts.is_pinned,
      preview_duration: posts.preview_duration,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      save_count: posts.save_count,
      view_count: posts.view_count,
      published_at: posts.published_at,
      created_at: posts.created_at,
      updated_at: posts.updated_at,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id));

  // Include ALL published posts (public + subscriber-gated).
  // Subscriber-locked items are included so subscribers can see them; is_locked is set per-item.
  let conditions = and(
    isNull(posts.deleted_at),
    eq(posts.status, "published"),
    sql`${posts.visibility} != 'draft'`,
  );

  // Apply content_type filter.
  // When omitted, ALL published content types are returned — shorts and albums
  // are first-class types that surface on their own screens (Shorts feed,
  // profile tabs), and each client consumer filters by content_type as needed.
  if (contentTypeFilter) {
    conditions = and(conditions, eq(posts.content_type, contentTypeFilter));
  }

  if (bookmarked && userId) {
    const bookmarkedIds = await db
      .select({ post_id: saved_posts.post_id })
      .from(saved_posts)
      .where(eq(saved_posts.user_id, userId));
    const ids = bookmarkedIds.map((b) => b.post_id);
    if (ids.length === 0) return ok({ posts: [], next_cursor: null, nextCursor: null, page, limit });
    conditions = and(
      and(isNull(posts.deleted_at), eq(posts.status, "published")),
      sql`${posts.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
    );
  }

  if (creatorId) {
    conditions = and(conditions, eq(posts.creator_id, creatorId));
  }

  // Compound cursor encodes both fields of the ORDER BY (published_at, id)
  if (cursor) {
    const sepIdx = cursor.lastIndexOf("__");
    if (sepIdx !== -1) {
      const cursorTs = cursor.slice(0, sepIdx);
      const cursorId = cursor.slice(sepIdx + 2);
      conditions = and(
        conditions,
        sql`(${posts.published_at} < ${cursorTs} OR (${posts.published_at} = ${cursorTs} AND ${posts.id} < ${cursorId}))`,
      );
    } else {
      conditions = and(conditions, sql`${posts.published_at} < ${cursor}`);
    }
  }

  const rows = await baseSelect
    .where(conditions)
    .orderBy(desc(posts.published_at), desc(posts.id))
    .limit(limit + 1)
    .offset(cursor ? 0 : (page - 1) * limit);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const postIds = items.map((p) => p.id);
  if (postIds.length === 0) return ok({ posts: [], next_cursor: null, nextCursor: null, page, limit });

  const allMedia = await db
    .select()
    .from(media)
    .where(sql`${media.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`);

  let likedSet = new Set<string>();
  let savedSet = new Set<string>();
  // Map of creator_id → subscription tier (for is_locked calculation)
  let subscriptionMap = new Map<string, string | null>();
  if (userId) {
    const liked = await db
      .select({ post_id: post_likes.post_id })
      .from(post_likes)
      .where(and(eq(post_likes.user_id, userId), sql`${post_likes.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`));
    likedSet = new Set(liked.map((l) => l.post_id));

    const saved = await db
      .select({ post_id: saved_posts.post_id })
      .from(saved_posts)
      .where(and(eq(saved_posts.user_id, userId), sql`${saved_posts.post_id} IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`));
    savedSet = new Set(saved.map((s) => s.post_id));

    // Look up active subscriptions for all creators in this page
    const creatorIds = [...new Set(items.map((p) => p.creator_id as string))];
    if (creatorIds.length > 0) {
      const subs = await db
        .select({ creator_id: subscriptions.creator_id, tier: subscriptions.tier })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.subscriber_id, userId),
            eq(subscriptions.status, "active"),
            sql`${subscriptions.creator_id} IN (${sql.join(creatorIds.map((id) => sql`${id}`), sql`, `)})`,
          ),
        );
      subscriptionMap = new Map(subs.map((s) => [s.creator_id, s.tier]));
    }
  }

  const mediaByPost = allMedia.reduce(
    (acc, m) => {
      if (!m.post_id) return acc;
      if (!acc[m.post_id]) acc[m.post_id] = [];
      acc[m.post_id].push(m as Record<string, unknown>);
      return acc;
    },
    {} as Record<string, Record<string, unknown>[]>,
  );

  const result = items.map((p) => {
    const isOwner = userId === (p.creator_id as string);
    const isSubscribed = subscriptionMap.has(p.creator_id as string);
    const subTier = subscriptionMap.get(p.creator_id as string) ?? null;
    const isLocked = !canViewContent(
      p.visibility as string,
      p.tier as string | null,
      isSubscribed,
      subTier,
      isOwner,
    );
    return postRow(p as Record<string, unknown>, mediaByPost[p.id] ?? [], likedSet.has(p.id), savedSet.has(p.id), isLocked);
  });

  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem
    ? `${lastItem.published_at ?? lastItem.created_at}__${lastItem.id}`
    : null;

  return ok({
    posts: result,
    next_cursor: nextCursor,
    nextCursor,
    page,
    limit,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;

  const {
    caption,
    title,
    description,
    content_type,
    visibility,
    tier,
    thumbnail_url,
    tags,
    preview_duration,
    expires_at,
    media: mediaItems,
    media_ids,
  } = parsed.data;

  const postId = generateId();
  const now = new Date().toISOString();

  await db.insert(posts).values({
    id: postId,
    creator_id: auth.user.userId,
    content_type: content_type ?? "post",
    caption: caption ?? null,
    title: title ?? null,
    description: description ?? null,
    thumbnail_url: thumbnail_url ?? null,
    tier: tier ?? null,
    tags: tags && tags.length > 0 ? JSON.stringify(tags) : null,
    visibility: visibility ?? "public",
    status: "published",
    preview_duration: preview_duration ?? null,
    expires_at: expires_at ?? null,
    published_at: now,
  });

  // Every post gets exactly one Comment Room. Its id === post id so the mobile
  // app receives a stable comment_room_id without guessing or deriving it.
  await db
    .insert(comment_rooms)
    .values({ id: postId, post_id: postId, comments_enabled: true, comment_count: 0 })
    .onConflictDoNothing();

  // Support inline media objects
  if (mediaItems && mediaItems.length > 0) {
    await db.insert(media).values(
      mediaItems.map((m, i) => ({
        id: generateId(),
        post_id: postId,
        uploader_id: auth.user.userId,
        url: m.url,
        blob_path: m.blob_path,
        type: m.type,
        mime_type: m.mime_type ?? null,
        size_bytes: m.size_bytes ?? null,
        width: m.width ?? null,
        height: m.height ?? null,
        duration_seconds: m.duration_seconds ?? null,
        thumbnail_url: m.thumbnail_url ?? null,
        sort_order: i,
      })),
    );
  }

  // Support media_ids: associate pre-uploaded media records with this post
  if (media_ids && media_ids.length > 0) {
    for (let i = 0; i < media_ids.length; i++) {
      await db
        .update(media)
        .set({ post_id: postId, sort_order: i })
        .where(and(eq(media.id, media_ids[i]), eq(media.uploader_id, auth.user.userId)));
    }
  }

  // Store category associations
  if (parsed.data.categories && parsed.data.categories.length > 0) {
    await db.insert(post_categories).values(
      parsed.data.categories.map((categoryId) => ({
        id: generateId(),
        post_id: postId,
        category_id: categoryId,
      })),
    ).onConflictDoNothing();
  }

  // The post is published inline by this endpoint. Notify subscribers after
  // all content associations are complete so the tap target is immediately
  // available to the mobile app.
  void notifySubscribersOfNewPost({
    creatorId: auth.user.userId,
    postId,
    contentType: content_type ?? "post",
    title,
  });

  return created({ id: postId });
}
