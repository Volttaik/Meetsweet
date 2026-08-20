import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import {
  getUploadSession,
  abortUploadSession,
  UploadError,
} from "@/lib/services/uploads";

/**
 * GET /api/uploads/:id
 * Status of an in-flight upload session (used by the client to resume).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  try {
    return ok(await getUploadSession(auth.user.userId, id));
  } catch (e) {
    if (e instanceof UploadError) return err(e.message, e.status, e.code);
    console.error("[uploads] get session failed:", e);
    return err("Failed to load upload session", 500);
  }
}

/**
 * DELETE /api/uploads/:id
 * Abort an in-flight upload (cancels the R2 multipart upload if any).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  try {
    await abortUploadSession(auth.user.userId, id);
    return ok({ cancelled: true });
  } catch (e) {
    if (e instanceof UploadError) return err(e.message, e.status, e.code);
    console.error("[uploads] abort failed:", e);
    return err("Failed to cancel upload", 500);
  }
}
