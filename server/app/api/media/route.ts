import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { created, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({
  url: z.string().url(),
  blob_path: z.string().min(1),
  type: z.enum(["image", "video", "audio", "document", "other"]),
  post_id: z.string().optional(),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  duration_seconds: z.number().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  file_name: z.string().optional(),
});

/**
 * POST /api/media
 * Register a media record after a direct-to-R2 upload.
 * The mobile app uploads directly to R2 via a signed URL, then
 * calls this endpoint to record the metadata.
 *
 * Accepts all media types: image, video, audio, document, other.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  // Ownership: the object key must sit under one of the authenticated user's
  // own storage prefixes. This prevents registering (and thereby claiming)
  // another user's uploaded object.
  const key = parsed.data.blob_path;
  const ownPrefixes = ["posts", "avatars", "uploads", "documents"].map(
    (folder) => `${folder}/${auth.user.userId}/`,
  );
  if (!ownPrefixes.some((prefix) => key.startsWith(prefix))) {
    return err("You may only register media under your own storage path", 403, "FORBIDDEN");
  }

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
    thumbnail_url: parsed.data.thumbnail_url ?? null,
    file_name: parsed.data.file_name ?? null,
  });

  return created({ media: { id: mediaId, ...parsed.data } });
}
