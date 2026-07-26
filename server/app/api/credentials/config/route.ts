import { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { config } from "@/lib/config";

/**
 * GET /api/credentials/config
 *
 * Returns public-safe configuration values the app needs at runtime.
 * Only values that are SAFE to expose to a logged-in client are included here.
 * Raw secrets (R2 keys, Resend key, Paystack secret, etc.) are NEVER returned.
 *
 * Auth required: Yes (prevents scraping by unauthenticated bots)
 *
 * Response:
 *   paystack_public_key  — Paystack publishable key (safe to use in client SDK)
 *   r2_public_base_url   — Optional public R2/CDN base URL if your bucket has public access
 *   app_id               — Client app identifier
 *   upload_limits        — Max file sizes per category (bytes)
 *   allowed_mime_types   — Accepted MIME types for uploads
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  return ok({
    r2_public_base_url: config.r2.publicBaseUrl() ?? null,
    app_id: config.app.clientId(),
    upload_limits: {
      image: 10 * 1024 * 1024,   // 10 MB
      video: 500 * 1024 * 1024,  // 500 MB
      audio: 50 * 1024 * 1024,   // 50 MB
      document: 25 * 1024 * 1024, // 25 MB
    },
    allowed_mime_types: {
      image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      video: ["video/mp4", "video/quicktime", "video/webm"],
      audio: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/webm"],
      document: [
        "application/pdf",
        "text/plain",
        "application/rtf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
    },
  });
}
