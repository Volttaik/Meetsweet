import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─── Client factory ─────────────────────────────────────────────────────────

function getClient(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials missing: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY are required"
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is required");
  return bucket;
}

// ─── MIME / size constants ───────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
];
const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "audio/webm",
];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;  // 500 MB
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;   // 50 MB

// ─── Exported helpers ────────────────────────────────────────────────────────

export type UploadedMedia = {
  /** R2 object key — what gets stored in the database */
  url: string;
  blob_path: string;
  size_bytes: number;
  mime_type: string;
};

export function getAllowedTypes(): string[] {
  return [
    ...ALLOWED_IMAGE_TYPES,
    ...ALLOWED_VIDEO_TYPES,
    ...ALLOWED_AUDIO_TYPES,
  ];
}

export function getMediaType(
  mimeType: string
): "image" | "video" | "audio" | null {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return "image";
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return "video";
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return "audio";
  return null;
}

export function getMaxBytes(mimeType: string): number {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return MAX_IMAGE_BYTES;
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return MAX_VIDEO_BYTES;
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return MAX_AUDIO_BYTES;
  return 0;
}

/**
 * Upload a file to R2.
 * Returns the R2 object key in both `url` and `blob_path`.
 * Callers must use `resolveUrl()` to produce a signed download URL for clients.
 */
export async function uploadBlob(
  file: Blob,
  mimeType: string,
  folder: string
): Promise<UploadedMedia> {
  const ext = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ContentLength: buffer.length,
    })
  );

  return { url: key, blob_path: key, size_bytes: file.size, mime_type: mimeType };
}

/**
 * Convert an R2 object key to a presigned download URL (default 7 days).
 * If the value already starts with "http" (legacy Vercel Blob URL), it is
 * returned as-is.
 * Returns null for null/undefined input.
 */
export async function resolveUrl(
  keyOrUrl: string | null | undefined,
  expiresIn = 604800
): Promise<string | null> {
  if (!keyOrUrl) return null;
  if (keyOrUrl.startsWith("http")) return keyOrUrl;
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: getBucket(), Key: keyOrUrl }),
    { expiresIn }
  );
}

/** Batch-sign multiple keys. */
export async function resolveUrls(
  keys: (string | null | undefined)[]
): Promise<(string | null)[]> {
  return Promise.all(keys.map((k) => resolveUrl(k)));
}

/**
 * Delete an R2 object by key.
 * Silently ignores legacy http:// URLs (Vercel Blob) — those can't be
 * deleted here.
 */
export async function deleteBlob(keyOrUrl: string): Promise<void> {
  try {
    if (keyOrUrl.startsWith("http")) return;
    await getClient().send(
      new DeleteObjectCommand({ Bucket: getBucket(), Key: keyOrUrl })
    );
  } catch {
    // Best-effort; don't fail the caller
  }
}
