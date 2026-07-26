import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { resolveUrl } from "@/lib/services/r2";

/**
 * GET /api/credentials/download-url?key=<object_key>
 *
 * Returns a presigned R2 GET URL valid for 7 days.
 * Call this when you have an object_key (from upload-url) and need a
 * readable URL to display or stream the file in the app.
 *
 * Query params:
 *   key  (required) — R2 object key returned by /api/credentials/upload-url
 *
 * Response:
 *   url         — presigned GET URL
 *   expires_in  — seconds until the URL expires (604800 = 7 days)
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return err("key query param is required", 400);
  if (key.startsWith("http")) return err("key must be an R2 object key, not a URL", 400);

  const url = await resolveUrl(key, 604800);
  if (!url) return err("Failed to generate download URL", 500);

  return ok({ url, expires_in: 604800 });
}
