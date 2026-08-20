import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { presignPartUrl, UploadError } from "@/lib/services/uploads";

/**
 * POST /api/uploads/:id/parts/:partNumber
 *
 * Re-issues a fresh presigned PUT URL for a single multipart part. Used by the
 * client to recover from an expired part URL or to resume a specific part
 * after a network interruption — without re-signing the whole upload.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; partNumber: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id, partNumber } = await params;
  const n = parseInt(partNumber, 10);
  if (Number.isNaN(n)) {
    return err("partNumber must be an integer", 422, "INVALID_PART");
  }

  try {
    const part = await presignPartUrl(auth.user.userId, id, n);
    return ok(part);
  } catch (e) {
    if (e instanceof UploadError) return err(e.message, e.status, e.code);
    console.error("[uploads] part-url failed:", e);
    return err("Failed to issue part URL", 500);
  }
}
