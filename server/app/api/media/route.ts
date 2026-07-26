import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({
  url: z.string().url(),
  blob_path: z.string().min(1),
  type: z.enum(["image", "video"]),
  post_id: z.string().optional(),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  duration_seconds: z.number().optional(),
});

/**
 * POST /api/media
 * Register a media record after a direct-to-R2 upload.
 * The mobile app uploads directly to R2 via a signed URL, then
 * calls this endpoint to record the metadata.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const mediaId = generateId();
  await db.insert(media).values({
    id: mediaId,
    uploader_id: auth.user.userId,
    post_id: parsed.data.post_id ?? null,
    url: parsed.data.url,
    blob_path: parsed.data.blob_path,
    type: parsed.data.type,
    mime_type: parsed.data.mime_type ?? null,
    size_bytes: parsed.data.size_bytes ?? null,
    width: parsed.data.width ?? null,
    height: parsed.data.height ?? null,
    duration_seconds: parsed.data.duration_seconds ?? null,
  });

  return created({ media: { id: mediaId, ...parsed.data } });
}
