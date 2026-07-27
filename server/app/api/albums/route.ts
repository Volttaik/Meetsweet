import { NextRequest } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { albums, profiles, users } from "@/lib/db/schema";
import { optionalAuth, requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { created, err, ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).optional(),
  cover_url: z.string().url().nullable().optional(),
  price_credits: z.number().int().min(0).max(1_000_000).default(0),
  is_premium: z.boolean().optional(),
  visibility: z.enum(["public", "subscribers", "private"]).default("public"),
});

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const creatorId = params.get("creator_id");
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const limit = Math.min(Math.max(1, Number(params.get("limit") ?? 20)), 50);
  const userId = (await optionalAuth(req))?.userId ?? null;

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
    .offset((page - 1) * limit);

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
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
    unlocked: !row.is_premium || row.price_credits <= 0 || row.creator_id === userId,
    creator: {
      id: row.creator_id,
      name: row.creator_name,
      username: row.creator_username,
      avatar_url: row.creator_avatar_url,
      avatarUrl: row.creator_avatar_url,
      is_verified: row.creator_is_verified,
      isVerified: row.creator_is_verified,
      is_online: false,
    },
  }));

  return ok({
    albums: items,
    page,
    limit,
    has_more: hasMore,
    hasMore,
    next_cursor: hasMore ? items[items.length - 1]?.created_at ?? null : null,
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
  const albumId = generateId();
  const isPremium = data.is_premium ?? (data.price_credits ?? 0) > 0;

  await db.insert(albums).values({
    id: albumId,
    creator_id: auth.user.userId,
    title: data.title,
    description: data.description ?? "",
    cover_url: data.cover_url ?? null,
    price_credits: data.price_credits,
    is_premium: isPremium,
    visibility: data.visibility,
  });

  return created({ album: await import("@/lib/services/albums").then(({ loadAlbum }) => loadAlbum(albumId, auth.user.userId)) });
}