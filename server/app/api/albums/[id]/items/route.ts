import { NextRequest } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { album_items, albums, media } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { created, err, ok } from "@/lib/api/response";
import { parseBody } from "@/lib/api/validate";
import { generateId } from "@/lib/auth/codes";

const itemSchema = z.object({
  media_id: z.string().min(1).optional(),
  media_ids: z.array(z.string().min(1)).min(1).max(50).optional(),
  sort_order: z.number().int().min(0).optional(),
}).refine((value) => value.media_id || value.media_ids?.length, {
  message: "media_id or media_ids is required",
});

async function ownedAlbum(albumId: string, userId: string) {
  const [album] = await db
    .select({ id: albums.id, creator_id: albums.creator_id })
    .from(albums)
    .where(eq(albums.id, albumId))
    .limit(1);
  if (!album) return { error: err("Album not found", 404), album: null };
  if (album.creator_id !== userId) return { error: err("Forbidden", 403), album: null };
  return { error: null, album };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await db
    .select({
      id: album_items.id,
      media_id: album_items.media_id,
      sort_order: album_items.sort_order,
      type: media.type,
      url: media.url,
      thumbnail_url: media.thumbnail_url,
      mime_type: media.mime_type,
      width: media.width,
      height: media.height,
      duration_secs: media.duration_seconds,
      file_size: media.size_bytes,
    })
    .from(album_items)
    .innerJoin(media, eq(media.id, album_items.media_id))
    .where(eq(album_items.album_id, id))
    .orderBy(asc(album_items.sort_order));
  return ok({ items: rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const owned = await ownedAlbum(id, auth.user.userId);
  if (owned.error) return owned.error;

  const parsed = await parseBody(req, itemSchema);
  if (!parsed.success) return parsed.response;
  const mediaIds = parsed.data.media_ids ?? [parsed.data.media_id!];

  const ownedMedia = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.uploader_id, auth.user.userId), sql`${media.id} IN (${sql.join(mediaIds.map((mediaId) => sql`${mediaId}`), sql`, `)})`));
  if (ownedMedia.length !== mediaIds.length) {
    return err("All media must belong to the album creator", 403, "MEDIA_NOT_OWNED");
  }

  const existing = await db
    .select({ media_id: album_items.media_id })
    .from(album_items)
    .where(and(eq(album_items.album_id, id), sql`${album_items.media_id} IN (${sql.join(mediaIds.map((mediaId) => sql`${mediaId}`), sql`, `)})`));
  const existingIds = new Set(existing.map((item) => item.media_id));
  const nextOrder = await db
    .select({ max: sql<number>`coalesce(max(${album_items.sort_order}), -1)` })
    .from(album_items)
    .where(eq(album_items.album_id, id));
  let order = parsed.data.sort_order ?? (nextOrder[0]?.max ?? -1) + 1;
  const newIds = mediaIds.filter((mediaId) => !existingIds.has(mediaId));

  if (newIds.length) {
    await db.insert(album_items).values(newIds.map((mediaId) => ({
      id: generateId(),
      album_id: id,
      media_id: mediaId,
      sort_order: order++,
    })));
    await db.update(albums).set({
      item_count: sql`${albums.item_count} + ${newIds.length}`,
      updated_at: new Date().toISOString(),
    }).where(eq(albums.id, id));
  }

  return created({ added: newIds, skipped: mediaIds.filter((mediaId) => existingIds.has(mediaId)) });
}