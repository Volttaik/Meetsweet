import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { album_items, albums } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { err, ok } from "@/lib/api/response";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id, mediaId } = await params;
  const [album] = await db.select({ id: albums.id, creator_id: albums.creator_id })
    .from(albums).where(eq(albums.id, id)).limit(1);
  if (!album) return err("Album not found", 404);
  if (album.creator_id !== auth.user.userId && auth.user.role !== "admin") return err("Forbidden", 403);

  const deleted = await db.delete(album_items)
    .where(and(eq(album_items.album_id, id), eq(album_items.media_id, mediaId)))
    .returning({ id: album_items.id });
  if (!deleted.length) return err("Album item not found", 404);
  await db.update(albums).set({
    item_count: sql`MAX(0, ${albums.item_count} - 1)`,
    updated_at: new Date().toISOString(),
  }).where(eq(albums.id, id));
  return ok({ removed: true });
}