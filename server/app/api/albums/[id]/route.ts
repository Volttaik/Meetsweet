import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { albums } from "@/lib/db/schema";
import { optionalAuth, requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { err, ok } from "@/lib/api/response";
import { loadAlbum } from "@/lib/services/albums";
import { hardDeleteAlbum } from "@/lib/services/deletion";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(4000).optional(),
  cover_url: z.string().url().nullable().optional(),
  price_credits: z.number().int().min(0).max(1_000_000).optional(),
  is_premium: z.boolean().optional(),
  visibility: z.enum(["public", "subscribers", "private"]).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = (await optionalAuth(req))?.userId ?? null;
  const album = await loadAlbum(id, userId);
  if (!album) return err("Album not found", 404, "NOT_FOUND");
  if (album.visibility === "private" && album.creator_id !== userId) {
    return err("Album not found", 404, "NOT_FOUND");
  }
  return ok({ album });
}

// Mobile app uses PUT for updates — alias to the same handler
export const PUT = async (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) => PATCH(req, ctx);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const [album] = await db
    .select({ id: albums.id, creator_id: albums.creator_id })
    .from(albums)
    .where(and(eq(albums.id, id), isNull(albums.deleted_at)))
    .limit(1);
  if (!album) return err("Album not found", 404);
  if (album.creator_id !== auth.user.userId && auth.user.role !== "admin") {
    return err("Forbidden", 403);
  }

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;
  const update = { ...parsed.data, updated_at: new Date().toISOString() };
  if (update.price_credits !== undefined && update.is_premium === undefined) {
    update.is_premium = update.price_credits > 0;
  }
  await db.update(albums).set(update).where(eq(albums.id, id));
  return ok({ album: await loadAlbum(id, auth.user.userId) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const [album] = await db
    .select({ id: albums.id, creator_id: albums.creator_id })
    .from(albums)
    .where(and(eq(albums.id, id), isNull(albums.deleted_at)))
    .limit(1);
  if (!album) return err("Album not found", 404);
  if (album.creator_id !== auth.user.userId && auth.user.role !== "admin") {
    return err("Forbidden", 403);
  }
  // Authoritative deletion: the album row, its items/unlocks, album-only media
  // rows and the R2/Stream storage objects are removed — the album can never
  // surface in Explore, search, profiles or purchase lists again.
  await hardDeleteAlbum(id);
  return ok({ deleted: true });
}