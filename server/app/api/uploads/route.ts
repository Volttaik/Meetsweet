import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import {
  uploadBlob,
  getMediaType,
  getMaxBytes,
  getAllowedTypes,
} from "@/lib/services/blob";
import { generateId } from "@/lib/auth/codes";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const contentType = req.headers.get("content-type") ?? "";
  const mimeType = contentType.split(";")[0].trim();

  const mediaType = getMediaType(mimeType);
  if (!mediaType) {
    return err(
      `Unsupported file type. Allowed: ${getAllowedTypes().join(", ")}`,
      422
    );
  }

  const blob = await req.blob();
  const maxBytes = getMaxBytes(mimeType);
  if (blob.size > maxBytes) {
    return err(`File too large (max ${maxBytes / 1024 / 1024}MB)`, 413);
  }

  const uploaded = await uploadBlob(blob, mimeType, `media/${auth.user.userId}`);

  const mediaId = generateId();
  await db.insert(media).values({
    id: mediaId,
    uploader_id: auth.user.userId,
    url: uploaded.url,
    blob_path: uploaded.blob_path,
    type: mediaType,
    mime_type: uploaded.mime_type,
    size_bytes: uploaded.size_bytes,
  });

  return ok({
    id: mediaId,
    url: uploaded.url,
    type: mediaType,
    mime_type: uploaded.mime_type,
    size_bytes: uploaded.size_bytes,
  });
}
