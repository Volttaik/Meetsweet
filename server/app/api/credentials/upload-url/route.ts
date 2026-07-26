import { NextRequest } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { config } from "@/lib/config";

const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Video
  "video/mp4",
  "video/quicktime",
  "video/webm",
  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "audio/webm",
  "application/pdf",
  "text/plain",
  "application/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

const MAX_BYTES: Record<string, number> = {
  image: 10 * 1024 * 1024,   // 10 MB
  video: 500 * 1024 * 1024,  // 500 MB
  audio: 50 * 1024 * 1024,   // 50 MB
  document: 25 * 1024 * 1024, // 25 MB
};

function getCategory(mime: string): "image" | "video" | "audio" | "document" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (
    mime.startsWith("text/") ||
    mime === "application/pdf" ||
    mime === "application/rtf" ||
    mime === "application/msword" ||
    mime === "application/vnd.ms-excel" ||
    mime.startsWith("application/vnd.openxmlformats-officedocument.")
  ) return "document";
  return null;
}

function getClient(): S3Client {
  const accountId = config.r2.accountId();
  const accessKeyId = config.r2.accessKeyId();
  const secretAccessKey = config.r2.secretAccessKey();
  if (!accountId || !accessKeyId || !secretAccessKey || !config.r2.bucket()) {
    throw new Error("Cloudflare R2 credentials are not configured");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/**
 * GET /api/credentials/upload-url?mime_type=image/jpeg&folder=avatars
 *
 * Returns a presigned R2 PUT URL valid for 15 minutes.
 * The client uploads directly to R2 using this URL — the raw R2 secret never leaves this server.
 *
 * Query params:
 *   mime_type  (required) — MIME type of the file to upload
 *   folder     (optional) — logical folder prefix, e.g. "avatars", "posts", "banners"
 *                           defaults to "uploads"
 *   size_bytes (optional) — declared file size for validation (integer)
 *
 * Response:
 *   upload_url  — presigned PUT URL (expires in 15 min)
 *   object_key  — R2 object key to store and later pass to /api/credentials/download-url
 *   expires_in  — seconds until the upload URL expires (900)
 *   max_bytes   — maximum allowed file size for this mime type
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const mime = req.nextUrl.searchParams.get("mime_type");
  if (!mime) return err("mime_type query param is required", 400);
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    return err(
      `Unsupported mime type. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
      422
    );
  }

  const category = getCategory(mime)!;
  const maxBytes = MAX_BYTES[category];

  const sizeParam = req.nextUrl.searchParams.get("size_bytes");
  if (sizeParam) {
    const declared = parseInt(sizeParam, 10);
    if (!isNaN(declared) && declared > maxBytes) {
      return err(`File too large. Max for ${category}: ${maxBytes / 1024 / 1024}MB`, 413);
    }
  }

  const folder = req.nextUrl.searchParams.get("folder")?.replace(/[^a-z0-9_-]/gi, "") || "uploads";
  if (!["uploads", "avatars", "posts", "documents"].includes(folder)) {
    return err("Unsupported upload folder", 422);
  }
  const extensionByMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/webm": "webm",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "application/rtf": "rtf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  const ext = extensionByMime[mime] ?? "bin";
  const objectKey = `${folder}/${auth.user.userId}/${crypto.randomUUID()}.${ext}`;

  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: config.r2.bucket()!,
      Key: objectKey,
      ContentType: mime,
    }),
    { expiresIn: 900 } // 15 minutes
  );

  return ok({
    upload_url: uploadUrl,
    object_key: objectKey,
    expires_in: 900,
    max_bytes: maxBytes,
  });
}
