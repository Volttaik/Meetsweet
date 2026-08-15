import { NextRequest } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { config } from "@/lib/config";

const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
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
  // Audio container variants produced by expo-av / native recorders
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/3gpp",
  "audio/amr",
  "audio/x-caf",
  // Documents
  "application/pdf",
  "text/plain",
  "application/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const MAX_BYTES_BY_CATEGORY: Record<string, number> = {
  image: 10 * 1024 * 1024,    // 10 MB
  video: 500 * 1024 * 1024,   // 500 MB
  audio: 50 * 1024 * 1024,    // 50 MB
  document: 25 * 1024 * 1024, // 25 MB
};

function getCategory(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/3gpp": "3gp",
  "audio/amr": "amr",
  "audio/x-caf": "caf",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/rtf": "rtf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function getClient(): S3Client {
  const accessKeyId = config.r2.accessKeyId();
  const secretAccessKey = config.r2.secretAccessKey();
  if (!accessKeyId || !secretAccessKey || !config.r2.bucket()) {
    throw new Error("Cloudflare R2 credentials are not configured");
  }
  const endpoint =
    config.r2.endpoint() ??
    (() => {
      const accountId = config.r2.accountId();
      if (!accountId) throw new Error("R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID must be set");
      return `https://${accountId}.r2.cloudflarestorage.com`;
    })();
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/**
 * POST /api/media/upload
 *
 * Accepts multipart/form-data with a "file" field.
 * Uploads the file to R2, records it in the media table, and returns the key + URL.
 *
 * Optional form fields:
 *   post_id  — associate the media record with an existing post
 *   folder   — storage prefix: "posts" (default) | "avatars"
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return err("Request must be multipart/form-data", 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return err('Missing "file" field in form data', 400);
  }

  const mimeType = file.type || "application/octet-stream";
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return err(
      `Unsupported file type "${mimeType}". Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
      422,
    );
  }

  const category = getCategory(mimeType);
  const maxBytes = MAX_BYTES_BY_CATEGORY[category];
  if (file.size > maxBytes) {
    return err(
      `File too large. Max for ${category}: ${maxBytes / 1024 / 1024} MB`,
      413,
    );
  }

  const folder = (formData.get("folder") as string | null)?.replace(/[^a-z0-9_-]/gi, "") || "posts";
  const ext = EXT_BY_MIME[mimeType] ?? "bin";
  const key = `${folder}/${auth.user.userId}/${crypto.randomUUID()}.${ext}`;
  const bucket = config.r2.bucket()!;

  const bytes = await file.arrayBuffer();

  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(bytes),
        ContentType: mimeType,
        ContentLength: file.size,
      }),
    );
  } catch (e) {
    console.error("[media/upload] R2 PutObject failed:", e);
    return err("Failed to upload file to storage", 502);
  }

  const publicBase = config.r2.publicBaseUrl();
  const url = publicBase ? `${publicBase.replace(/\/$/, "")}/${key}` : key;

  const mediaId = generateId();
  const postId = (formData.get("post_id") as string | null) || null;
  const fileName = (formData.get("file_name") as string | null) || null;

  await db.insert(media).values({
    id: mediaId,
    uploader_id: auth.user.userId,
    post_id: postId,
    url,
    blob_path: key,
    type: category,
    mime_type: mimeType,
    size_bytes: file.size,
    file_name: fileName,
  });

  return created({
    media: {
      id: mediaId,
      url,
      key,
      type: category,
      mime_type: mimeType,
      size_bytes: file.size,
    },
    // Top-level aliases — the mobile uploadMedia reads resp.url / resp.id directly.
    id: mediaId,
    media_id: mediaId,
    url,
    media_type: category,
    key,
  });
}
