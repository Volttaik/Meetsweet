import { NextRequest } from "next/server";
import { eq, and, desc, isNull, gte, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, users, profiles, album_unlocks, devices, subscriptions, user_settings } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20)), 50);
  const userId = (await optionalAuth(req))?.userId ?? null;

  const condition = id.includes("-") && id.length > 20 ? eq(users.id, id) : eq(users.username, id);
  const [creator] = await db.select({ id: users.id, is_creator: users.is_creator })
    .from(users).where(and(condition, eq(users.is_active, true), isNull(users.deleted_at))).limit(1);
  if (!creator || !creator.is_creator) return err("Creator not found", 404);

  // Presence: "online" = a device seen within the last 10 minutes (real signal).
  // The creator's privacy settings gate the indicator — turning off Online /
  // Activity status hides it from everyone (server-enforced).
  const [presenceSettings] = await db
    .select({ online_status: user_settings.online_status, activity_status: user_settings.activity_status })
    .from(user_settings)
    .where(eq(user_settings.user_id, creator.id))
    .limit(1);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  let isOnline = false;
  if (presenceSettings?.online_status !== false && presenceSettings?.activity_status !== false) {
    const [recentDevice] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.user_id, creator.id), gte(devices.last_seen_at, tenMinutesAgo)))
      .limit(1);
    isOnline = Boolean(recentDevice);
  }

  // Visibility-aware: the owner sees all their albums (public / subscribers /
  // private); active subscribers additionally see subscriber-only albums;
  // everyone else sees public albums only.
  let visibilityCond: SQL | undefined = eq(albums.visibility, "public");
  if (userId === creator.id) {
    visibilityCond = or(
      eq(albums.visibility, "public"),
      eq(albums.visibility, "subscribers"),
      eq(albums.visibility, "private"),
    );
  } else if (userId) {
    const [sub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.subscriber_id, userId),
          eq(subscriptions.creator_id, creator.id),
          eq(subscriptions.status, "active"),
        ),
      )
      .limit(1);
    if (sub) {
      visibilityCond = or(eq(albums.visibility, "public"), eq(albums.visibility, "subscribers"));
    }
  }

  const rows = await db
    .select({
      id: albums.id,
      creator_id: albums.creator_id,
      title: albums.title,
      description: albums.description,
      cover_url: albums.cover_url,
      price_credits: albums.price_credits,
      is_premium: albums.is_premium,
      visibility: albums.visibility,
      item_count: albums.item_count,
      created_at: albums.created_at,
      updated_at: albums.updated_at,
      creator_name: users.full_name,
      creator_username: users.username,
      creator_avatar_url: profiles.avatar_url,
      creator_is_verified: users.is_verified,
    })
    .from(albums)
    .innerJoin(users, eq(users.id, albums.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, albums.creator_id))
    .where(and(
      eq(albums.creator_id, creator.id),
      isNull(albums.deleted_at),
      visibilityCond,
    ))
    .orderBy(desc(albums.created_at))
    .limit(limit + 1)
    .offset((page - 1) * limit);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const albumIds = items.map((a) => a.id);

  const unlockedSet = userId && albumIds.length > 0
    ? await db.select({ album_id: album_unlocks.album_id }).from(album_unlocks)
        .where(eq(album_unlocks.user_id, userId))
        .then((r) => new Set(r.map((x) => x.album_id)))
    : new Set<string>();

  const result = items.map((row) => ({
    id: row.id,
    creator_id: row.creator_id,
    title: row.title,
    description: row.description,
    cover_url: row.cover_url,
    coverUrl: row.cover_url,
    preview_urls: row.cover_url ? [row.cover_url] : [],
    previewUrls: row.cover_url ? [row.cover_url] : [],
    price_credits: row.price_credits,
    priceCredits: row.price_credits,
    is_premium: row.is_premium,
    isPremium: row.is_premium,
    visibility: row.visibility,
    item_count: row.item_count,
    itemCount: row.item_count,
    created_at: row.created_at,
    createdAt: row.created_at,
    is_unlocked_by_me: unlockedSet.has(row.id) || !row.is_premium || row.creator_id === userId,
    isUnlockedByMe: unlockedSet.has(row.id) || !row.is_premium || row.creator_id === userId,
    creator: {
      id: row.creator_id,
      name: row.creator_name,
      username: row.creator_username,
      avatar_url: row.creator_avatar_url,
      avatarUrl: row.creator_avatar_url,
      is_verified: row.creator_is_verified,
      isVerified: row.creator_is_verified,
      is_online: isOnline,
      isOnline,
    },
  }));

  return ok({
    albums: result,
    page,
    limit,
    has_more: hasMore,
    hasMore,
    next_cursor: hasMore ? items[items.length - 1]?.created_at ?? null : null,
  });
}
