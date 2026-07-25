import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { resolveUrl } from "@/lib/services/r2";

/**
 * GET /api/media/signed-url?key=<r2-object-key>
 * Returns a fresh presigned download URL for the given R2 key.
 * Clients should call this when a previously issued URL has expired.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return err("key query parameter is required", 400);

  // Reject attempts to sign external URLs
  if (key.startsWith("http")) return err("key must be an R2 object key, not a URL", 400);

  const signedUrl = await resolveUrl(key);
  if (!signedUrl) return err("Failed to sign URL", 500);

  return ok({ url: signedUrl, expires_in: 604800 });
}
