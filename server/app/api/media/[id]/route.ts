import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const patchSchema = z.object({
  thumbnail_url: z.string().url().nullable().optional(),
  file_name: z.string().max(255).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  duration_seconds: z.number().optional(),
});

/**
 * PATCH /api/media/:id
 * Update a media record — typically used to attach a thumbnail after upload.
 * Only the uploader can update their own media record.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [row] = await db
    .select({ id: media.id, uploader_id: media.uploader_id })
    .from(media)
    .where(eq(media.id, id))
    .limit(1);

  if (!row) return err("Media not found", 404);
  if (row.uploader_id !== auth.user.userId) return err("Forbidden", 403);

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;

  await db
    .update(media)
    .set(parsed.data)
    .where(and(eq(media.id, id), eq(media.uploader_id, auth.user.userId)));

  const [updated] = await db.select().from(media).where(eq(media.id, id)).limit(1);

  return ok({
    media: {
      id: updated!.id,
      url: updated!.url,
      type: updated!.type,
      thumbnail_url: updated!.thumbnail_url ?? null,
      mime_type: updated!.mime_type ?? null,
      file_name: updated!.file_name ?? null,
      width: updated!.width ?? null,
      height: updated!.height ?? null,
      duration_seconds: updated!.duration_seconds ?? null,
      size_bytes: updated!.size_bytes ?? null,
    },
  });
}
