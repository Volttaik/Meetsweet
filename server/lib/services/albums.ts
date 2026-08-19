import { and, asc, eq, isNull, gte } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Quality variants for an album media item. Always a single progressive MP4:
 * album playback runs through expo-av (MsVideoPlayer), which cannot play HLS.
 * Multi-quality remains exclusive to long-form videos.
 */
function buildAlbumQualities(item: {
  url: string | null;
  height?: number | null;
}): Array<{ label: string; url: string; height: number | null; index?: number | null }> {
  return [{ label: "Auto", url: item.url ?? "", height: item.height ?? null, index: null }];
}
import {
  albums,
  album_items,
  album_unlocks,
  media,
  profiles,
  users,
  devices,
} from "@/lib/db/schema";

export async function loadAlbum(albumId: string, userId?: string | null) {
  const [row] = await db
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
    .where(and(eq(albums.id, albumId), isNull(albums.deleted_at), eq(users.is_active, true), isNull(users.deleted_at)))
    .limit(1);

  if (!row) return null;

  const [unlock] = userId
    ? await db
        .select({ id: album_unlocks.id })
        .from(album_unlocks)
        .where(and(eq(album_unlocks.album_id, albumId), eq(album_unlocks.user_id, userId)))
        .limit(1)
    : [];

  const unlocked =
    !row.is_premium || row.price_credits <= 0 || row.creator_id === userId || !!unlock;

  const itemRows = await db
    .select({
      id: album_items.id,
      media_id: album_items.media_id,
      sort_order: album_items.sort_order,
      type: media.type,
      url: media.url,
      thumbnail_url: media.thumbnail_url,
      mime_type: media.mime_type,
      size_bytes: media.size_bytes,
      width: media.width,
      height: media.height,
      duration_seconds: media.duration_seconds,
    })
    .from(album_items)
    .innerJoin(media, eq(media.id, album_items.media_id))
    .where(eq(album_items.album_id, albumId))
    .orderBy(asc(album_items.sort_order));

  const items = itemRows.map((item) => ({
    id: item.id,
    media_id: item.media_id,
    type: item.type,
    sort_order: item.sort_order,
    url: unlocked ? item.url : null,
    media_url: unlocked ? item.url : null,
    thumbnail_url: unlocked ? item.thumbnail_url : null,
    mime_type: item.mime_type,
    file_size: unlocked ? item.size_bytes : null,
    width: unlocked ? item.width : null,
    height: unlocked ? item.height : null,
    duration_secs: unlocked ? item.duration_seconds : null,
    // Server-authoritative playable qualities (single Auto MP4 entry — album
    // playback runs through expo-av, which cannot play HLS). Nulled for locked
    // items so no media URL leaks before purchase.
    qualities: unlocked && item.url ? buildAlbumQualities(item) : [],
    is_locked: !unlocked,
  }));

  // Presence: "online" = a device seen within the last 10 minutes (real signal).
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const [recentDevice] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.user_id, row.creator_id), gte(devices.last_seen_at, tenMinutesAgo)))
    .limit(1);
  const isOnline = Boolean(recentDevice);

  const creator = {
    id: row.creator_id,
    name: row.creator_name,
    username: row.creator_username,
    avatar_url: row.creator_avatar_url,
    avatarUrl: row.creator_avatar_url,
    is_verified: row.creator_is_verified,
    isVerified: row.creator_is_verified,
    is_online: isOnline,
    isOnline,
  };

  return {
    id: row.id,
    creator_id: row.creator_id,
    title: row.title,
    description: row.description,
    cover_url: row.cover_url,
    coverUrl: row.cover_url,
    price_credits: row.price_credits,
    priceCredits: row.price_credits,
    is_premium: row.is_premium,
    isPremium: row.is_premium,
    visibility: row.visibility,
    item_count: row.item_count,
    itemCount: row.item_count,
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    unlocked,
    is_unlocked: unlocked,
    creator,
    creator_name: row.creator_name,
    creator_username: row.creator_username,
    creator_avatar_url: row.creator_avatar_url,
    items,
  };
}