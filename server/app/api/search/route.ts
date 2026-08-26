import { NextRequest } from "next/server";
import { eq, like, or, and, isNull, desc, sql, notInArray, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, posts, albums, hidden_posts, user_settings } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { recent_searches } from "@/lib/db/schema";
import { getHiddenCreatorIds } from "@/lib/services/content";
import { enrichCreatorRows } from "@/lib/services/creator-discovery";

/**
 * GET /api/search?q=&type=&page=&limit=
 *
 * Server-authoritative, relevance-ranked search across users, content
 * (posts/videos/shorts) and albums. The client never filters the whole DB
 * locally — this endpoint returns ranked, paginated results.
 *
 * Relevance tiers (per section): exact match > prefix > substring, with
 * creator/verified boosts for users and engagement + freshness for content,
 * so exact matches rank above weak partial matches and old-but-engaging
 * content can still surface. SQLite's LIKE is ASCII case-insensitive, so
 * capitalization is handled; lower() guards other scripts.
 *
 * The viewer's hidden/blocked creators and Not-Interested posts are excluded.
 * Only free/public content is searchable (discovery surface) — subscriber
 * media never leaks through search.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const type = req.nextUrl.searchParams.get("type") ?? "all"; // all | users | creators | posts
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);
  const offset = (page - 1) * limit;

  const currentUser = await optionalAuth(req);
  const userId = currentUser?.userId ?? null;

  // Empty searches return empty results (never an error) — the client renders
  // the empty state without a server round-trip complaint.
  if (q.length < 1) {
    return ok({ users: [], posts: [], albums: [], page, limit, has_more: false, hasMore: false });
  }

  // Hidden/blocked creators and Not-Interested posts stay out of results.
  const hiddenCreatorIds = userId ? await getHiddenCreatorIds(userId) : [];
  let hiddenPostIds: string[] = [];
  if (userId) {
    const hidden = await db
      .select({ post_id: hidden_posts.post_id })
      .from(hidden_posts)
      .where(eq(hidden_posts.user_id, userId));
    hiddenPostIds = hidden.map((h) => h.post_id);
  }

  const pattern = `%${q}%`;
  const qLower = q.toLowerCase();
  const hiddenCond =
    hiddenCreatorIds.length > 0 ? [notInArray(users.id, hiddenCreatorIds)] : [];
  const hiddenPostCond =
    hiddenPostIds.length > 0 ? [notInArray(posts.id, hiddenPostIds)] : [];

  let userResults: unknown[] = [];
  let postResults: unknown[] = [];
  let albumResults: unknown[] = [];

  // ── Users / creators ────────────────────────────────────────────────────
  if (type === "all" || type === "users" || type === "creators") {
    const relevance = sql`(
      CASE
        WHEN lower(${users.username}) = ${qLower} THEN 100
        WHEN lower(COALESCE(${profiles.display_name}, ${users.full_name})) = ${qLower} THEN 90
        WHEN ${users.username} LIKE ${q} || '%' THEN 85
        WHEN lower(COALESCE(${profiles.display_name}, ${users.full_name})) LIKE ${q} || '%' THEN 70
        WHEN ${users.username} LIKE ${pattern} THEN 45
        WHEN lower(COALESCE(${profiles.display_name}, ${users.full_name})) LIKE ${pattern} THEN 30
        ELSE 15
      END
      + CASE WHEN ${users.is_creator} THEN 10 ELSE 0 END
      + CASE WHEN ${users.is_verified} THEN 5 ELSE 0 END
    )`;

    const rows = await db
      .select({
        id: users.id,
        full_name: users.full_name,
        username: users.username,
        display_name: profiles.display_name,
        avatar_url: profiles.avatar_url,
        banner_url: profiles.banner_url,
        bio: profiles.bio,
        is_verified: users.is_verified,
        is_creator: users.is_creator,
        is_verified_creator: profiles.is_verified_creator,
        category: profiles.category,
        relevance,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.user_id, users.id))
      .leftJoin(user_settings, eq(user_settings.user_id, users.id))
      .where(
        and(
          eq(users.is_active, true),
          isNull(users.deleted_at),
          type === "creators" ? eq(users.is_creator, true) : undefined,
          or(
            like(users.username, pattern),
            like(users.full_name, pattern),
            like(profiles.display_name, pattern),
          ),
          // Privacy: accounts that turned off Search Visibility never appear
          // in search — enforced server-side, not filtered on the client.
          or(isNull(user_settings.search_visible), eq(user_settings.search_visible, true)),
          // Private accounts are not discoverable — they can only be reached
          // via a direct profile link.
          or(isNull(user_settings.private_account), eq(user_settings.private_account, false)),
          ...hiddenCond,
        ),
      )
      .orderBy(desc(relevance), desc(users.created_at))
      .limit(limit)
      .offset(offset);

    // Enrich with live subscriber counts, viewer subscription state and
    // online presence (same shape as the Explore featured-creators list) so
    // creator search results render the full card without extra requests.
    userResults = await enrichCreatorRows(rows, userId);
  }

  // ── Posts / videos / shorts ─────────────────────────────────────────────
  if (type === "all" || type === "posts") {
    const relevance = sql`(
      CASE
        WHEN lower(COALESCE(${posts.title}, '')) = ${qLower} THEN 90
        WHEN ${posts.title} LIKE ${q} || '%' THEN 75
        WHEN ${posts.caption} LIKE ${q} || '%' THEN 65
        WHEN ${users.username} LIKE ${q} || '%' THEN 60
        WHEN lower(COALESCE(${profiles.display_name}, ${users.full_name})) LIKE ${q} || '%' THEN 55
        WHEN ${posts.title} LIKE ${pattern} THEN 45
        WHEN ${posts.caption} LIKE ${pattern} THEN 35
        ELSE 15
      END
      + min(
          COALESCE(${posts.like_count}, 0) * 2
          + COALESCE(${posts.comment_count}, 0) * 3
          + COALESCE(${posts.view_count}, 0) * 0.02,
          30
        )
      + (1.0 / (1.0 + (julianday('now') - julianday(COALESCE(${posts.published_at}, ${posts.created_at}))))) * 3.0
    )`;

    const rows = await db
      .select({
        id: posts.id,
        creator_id: posts.creator_id,
        creator_username: users.username,
        creator_display_name: profiles.display_name,
        creator_avatar: profiles.avatar_url,
        creator_is_verified: users.is_verified,
        caption: posts.caption,
        title: posts.title,
        content_type: posts.content_type,
        visibility: posts.visibility,
        tier: posts.tier,
        like_count: posts.like_count,
        comment_count: posts.comment_count,
        save_count: posts.save_count,
        view_count: posts.view_count,
        share_count: posts.share_count,
        created_at: posts.created_at,
        published_at: posts.published_at,
        relevance,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.creator_id))
      .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
      .where(
        and(
          isNull(posts.deleted_at),
          eq(users.is_active, true),
          isNull(users.deleted_at),
          eq(posts.status, "published"),
          eq(posts.visibility, "public"),
          // Discovery surface — free content only; subscriber media never
          // leaks through search.
          or(eq(posts.tier, "free"), isNull(posts.tier)),
          inArray(posts.content_type, ["post", "video", "short"]),
          or(
            like(posts.title, pattern),
            like(posts.caption, pattern),
            like(users.username, pattern),
            like(profiles.display_name, pattern),
          ),
          // Private accounts: posts are only searchable by the owner and
          // active subscribers — enforced server-side.
          userId
            ? sql`(
                NOT EXISTS (
                  SELECT 1 FROM user_settings us
                  WHERE us.user_id = ${posts.creator_id} AND us.private_account = 1
                )
                OR ${posts.creator_id} = ${userId}
                OR EXISTS (
                  SELECT 1 FROM subscriptions s
                  WHERE s.subscriber_id = ${userId}
                    AND s.creator_id = ${posts.creator_id}
                    AND s.status = 'active'
                )
              )`
            : sql`NOT EXISTS (
                SELECT 1 FROM user_settings us
                WHERE us.user_id = ${posts.creator_id} AND us.private_account = 1
              )`,
          ...hiddenCreatorIds.length > 0 ? [notInArray(posts.creator_id, hiddenCreatorIds)] : [],
          ...hiddenPostCond,
        ),
      )
      .orderBy(desc(relevance), desc(posts.published_at), desc(posts.id))
      .limit(limit)
      .offset(offset);

    postResults = rows;
  }

  // ── Albums (separate table — own ranked section) ────────────────────────
  if (type === "all" || type === "posts") {
    const relevance = sql`(
      CASE
        WHEN lower(${albums.title}) = ${qLower} THEN 90
        WHEN ${albums.title} LIKE ${q} || '%' THEN 70
        WHEN ${albums.description} LIKE ${q} || '%' THEN 50
        WHEN ${albums.title} LIKE ${pattern} THEN 40
        WHEN ${albums.description} LIKE ${pattern} THEN 25
        ELSE 10
      END
      + (1.0 / (1.0 + (julianday('now') - julianday(${albums.created_at})))) * 3.0
    )`;

    const rows = await db
      .select({
        id: albums.id,
        creator_id: albums.creator_id,
        creator_username: users.username,
        creator_display_name: profiles.display_name,
        creator_avatar: profiles.avatar_url,
        creator_is_verified: users.is_verified,
        title: albums.title,
        description: albums.description,
        cover_url: albums.cover_url,
        price_credits: albums.price_credits,
        is_premium: albums.is_premium,
        item_count: albums.item_count,
        created_at: albums.created_at,
        relevance,
      })
      .from(albums)
      .innerJoin(users, eq(users.id, albums.creator_id))
      .leftJoin(profiles, eq(profiles.user_id, albums.creator_id))
      .where(
        and(
          isNull(albums.deleted_at),
          eq(albums.visibility, "public"),
          eq(users.is_active, true),
          isNull(users.deleted_at),
          or(
            like(albums.title, pattern),
            like(albums.description, pattern),
          ),
          ...hiddenCreatorIds.length > 0 ? [notInArray(albums.creator_id, hiddenCreatorIds)] : [],
        ),
      )
      .orderBy(desc(relevance), desc(albums.created_at))
      .limit(limit)
      .offset(offset);

    albumResults = rows.map((a) => ({
      id: a.id,
      content_type: "album",
      creator_id: a.creator_id,
      creator_username: a.creator_username,
      creator_display_name: a.creator_display_name,
      creator_avatar: a.creator_avatar,
      creator_is_verified: a.creator_is_verified,
      title: a.title,
      description: a.description,
      thumbnail_url: a.cover_url,
      cover_url: a.cover_url,
      price_credits: a.price_credits,
      is_premium: a.is_premium,
      item_count: a.item_count,
      created_at: a.created_at,
    }));
  }

  // Save to recent searches if authenticated (fire-and-forget)
  if (currentUser && q.length >= 2) {
    db.insert(recent_searches).values({
      id: generateId(),
      user_id: currentUser.userId,
      query: q,
    }).catch(() => {}); // ignore errors
  }

  return ok({ users: userResults, posts: postResults, albums: albumResults, page, limit });
}
