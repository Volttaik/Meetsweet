import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { createUploadSession, UploadError } from "@/lib/services/uploads";

const schema = z.object({
  mime_type: z.string().min(1),
  file_name: z.string().max(255).optional().nullable(),
  size_bytes: z.number().int().optional().nullable(),
  folder: z.string().optional(),
  transcode: z.boolean().optional(),
});

/**
 * POST /api/uploads
 *
 * Authorize a direct-to-R2 upload. Returns either a single presigned PUT URL
 * (small files) or a multipart upload id + presigned part URLs (large files).
 * No media bytes pass through this request body.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  try {
    const session = await createUploadSession(auth.user.userId, {
      mimeType: parsed.data.mime_type,
      fileName: parsed.data.file_name,
      sizeBytes: parsed.data.size_bytes,
      folder: parsed.data.folder,
      transcode: parsed.data.transcode,
    });
    return ok(session);
  } catch (e) {
    if (e instanceof UploadError) return err(e.message, e.status, e.code);
    console.error("[uploads] create session failed:", e);
    return err("Failed to authorize upload", 500);
  }
}
