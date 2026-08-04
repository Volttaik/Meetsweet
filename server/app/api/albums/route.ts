import { NextRequest } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { albums, album_items, album_unlocks, media, profiles, users } from "@/lib/db/schema";
import { optionalAuth, requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { created, err, ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).optional(),
  // cover_media_id: ID of a pre-uploaded media record whose URL will be used as cover_url.
  // Takes priority over cover_url when both are provided.
  cover_media_id: z.string().optional(),
  cover_url: z.string().url().nullable().optional(),
  // unlock_price / price_credits — mobile sends unlock_price; both are accepted
  unlock_price: z.number().int().min(0).max(1_000_000).optional(),
  price_credits: z.number().int().min(0).max(1_000_000).optional(),
  is_premium: z.boolean().optional(),
  // visibility: 'draft' is mapped to 'private' in storage
  visibility: z.enum(["public", "subscribers", "private", "draft"]).default("public"),
  // media_ids: pre-uploaded media IDs to add as album items on creation
  media_ids: z.array(z.string()).max(100).optional(),
  categories: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const creatorId = params.get("creator_id");
  const cursor = params.get("cursor");
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const limit = Math.min(Math.max(1, Number(params.get("limit") ?? 20)), 50);
  const purchasedOnly = params.get("purchased") === "true";
  const userId = (await optionalAuth(req))?.userId ?? null;

  // When ?purchased=true, return albums the current user has unlocked
  if (purchasedOnly) {
    if (!userId) return ok({ albums: [], next_cursor: null, has_more: false });
    const unlockRows = await db
      .select({ album_id: album_unlocks.album_id })
      .from(album_unlocks)
      .where(eq(album_unlocks.user_id, userId));
    const albumIds = unlockRows.map((u) => u.album_id);
    if (albumIds.length === 0) return ok({ albums: [], next_cursor: null, has_more: false });

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
      .where(and(isNull(albums.deleted_at), inArray(albums.id, albumIds)));

    return ok({
      albums: rows.map((row) => formatAlbum(row, userId, true)),
      next_cursor: null,
      has_more: false,
    });
  }

  let conditions = and(isNull(albums.deleted_at), eq(albums.visibility, "public"));
  if (creatorId) conditions = and(conditions, eq(albums.creator_id, creatorId));

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
    .where(conditions)
    .orderBy(desc(albums.created_at))
    .limit(limit + 1)
    .offset(cursor ? 0 : (page - 1) * limit);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  // Check which albums the viewer has unlocked
  let unlockedSet = new Set<string>();
  if (userId && items.length > 0) {
    const albumIds = items.map((r) => r.id);
    const unlockRows = await db
      .select({ album_id: album_unlocks.album_id })
      .from(album_unlocks)
      .where(and(eq(album_unlocks.user_id, userId), inArray(album_unlocks.album_id, albumIds)));
    unlockedSet = new Set(unlockRows.map((u) => u.album_id));
  }

  const formatted = items.map((row) =>
    formatAlbum(row, userId, unlockedSet.has(row.id)),
  );

  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? lastItem.created_at : null;

  return ok({
    albums: formatted,
    page,
    limit,
    has_more: hasMore,
    hasMore,
    next_cursor: nextCursor,
    nextCursor,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  if (auth.user.role !== "creator" && auth.user.role !== "admin") {
    return err("Creator account required", 403, "CREATOR_REQUIRED");
  }

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;
  const data = parsed.data;

  // Resolve cover_url: cover_media_id takes priority over inline cover_url
  let coverUrl: string | null = data.cover_url ?? null;
  if (data.cover_media_id) {
    const [coverMedia] = await db
      .select({ url: media.url })
      .from(media)
      .where(eq(media.id, data.cover_media_id))
      .limit(1);
    if (coverMedia) coverUrl = coverMedia.url;
  }

  // Resolve price: unlock_price takes priority over price_credits
  const priceCredits = data.unlock_price ?? data.price_credits ?? 0;
  const isPremium = data.is_premium ?? priceCredits > 0;

  // Map 'draft' visibility to 'private' for storage
  const visibility = data.visibility === "draft" ? "private" : data.visibility;

  const albumId = generateId();

  await db.insert(albums).values({
    id: albumId,
    creator_id: auth.user.userId,
    title: data.title,
    description: data.description ?? "",
    cover_url: coverUrl,
    price_credits: priceCredits,
    is_premium: isPremium,
    visibility: visibility as "public" | "subscribers" | "private",
  });

  // Add media items immediately if media_ids were provided
  if (data.media_ids && data.media_ids.length > 0) {
    const mediaRows = await db
      .select({ id: media.id, url: media.url, thumbnail_url: media.thumbnail_url })
      .from(media)
      .where(inArray(media.id, data.media_ids));

    if (mediaRows.length > 0) {
      // Insert in the order the mobile specified
      const orderedMedia = data.media_ids
        .map((id) => mediaRows.find((m) => m.id === id))
        .filter(Boolean) as typeof mediaRows;

      await db.insert(album_items).values(
        orderedMedia.map((m, i) => ({
          id: generateId(),
          album_id: albumId,
          media_id: m.id,
          sort_order: i,
        })),
      );

      // Update item_count
      await db
        .update(albums)
        .set({ item_count: orderedMedia.length })
        .where(eq(albums.id, albumId));

      // Set the first image as cover if no cover was supplied
      if (!coverUrl && orderedMedia[0]) {
        await db
          .update(albums)
          .set({ cover_url: orderedMedia[0].thumbnail_url ?? orderedMedia[0].url })
          .where(eq(albums.id, albumId));
      }
    }
  }

  // Mobile's createAlbum() expects { id: string } after envelope unwrap
  return created({ id: albumId });
}

// ─── Formatting helper ─────────────────────────────────────────────────────

function formatAlbum(
  row: {
    id: string;
    creator_id: string;
    title: string;
    description: string;
    cover_url: string | null;
    price_credits: number;
    is_premium: boolean;
    visibility: string;
    item_count: number;
    created_at: string;
    updated_at: string;
    creator_name: string;
    creator_username: string;
    creator_avatar_url: string | null;
    creator_is_verified: boolean;
  },
  viewerId: string | null,
  isUnlocked: boolean,
) {
  const unlocked =
    isUnlocked || !row.is_premium || row.price_credits <= 0 || row.creator_id === viewerId;

  return {
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
    unlock_price: row.price_credits,
    unlockPrice: row.price_credits,
    is_premium: row.is_premium,
    isPremium: row.is_premium,
    visibility: row.visibility,
    item_count: row.item_count,
    itemCount: row.item_count,
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
    is_unlocked_by_me: unlocked,
    isUnlockedByMe: unlocked,
    creator: {
      id: row.creator_id,
      name: row.creator_name,
      full_name: row.creator_name,
      username: row.creator_username,
      avatar_url: row.creator_avatar_url,
      avatarUrl: row.creator_avatar_url,
      is_verified: row.creator_is_verified,
      isVerified: row.creator_is_verified,
      is_online: false,
    },
    // Flat creator fields for normalizers that read top-level
    creator_username: row.creator_username,
    creator_display_name: row.creator_name,
    creator_avatar: row.creator_avatar_url,
    creator_is_verified: row.creator_is_verified,
  };
}
