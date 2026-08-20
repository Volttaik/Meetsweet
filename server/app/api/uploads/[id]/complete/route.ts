import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { completeUploadSession, UploadError } from "@/lib/services/uploads";

const partSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1),
});

const schema = z.object({
  parts: z.array(partSchema).optional(),
  post_id: z.string().optional().nullable(),
});

/**
 * POST /api/uploads/:id/complete
 *
 * Finalize an upload. The client reports the parts it uploaded (partNumber +
 * ETag); the server validates ownership and the part list, completes the
 * multipart upload (or HEADs the single object), and only then creates the
 * media record. Idempotent — a duplicate completion returns the existing row.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  try {
    const result = await completeUploadSession(
      auth.user.userId,
      id,
      (parsed.data.parts ?? []).map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      parsed.data.post_id,
    );
    return ok(result);
  } catch (e) {
    if (e instanceof UploadError) return err(e.message, e.status, e.code);
    console.error("[uploads] complete failed:", e);
    return err("Failed to finalize upload", 500);
  }
}
