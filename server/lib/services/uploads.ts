/**
 * Direct-to-storage upload service.
 *
 * The mobile app never sends media bytes through the Vercel API. Instead:
 *
 *   1. createUploadSession()  — authorize the upload, allocate an R2 key under
 *      <folder>/<userId>/<uuid>.<ext>, and either (a) presign a single PUT URL
 *      for small files or (b) open an S3/R2 multipart upload and presign a URL
 *      for every part.
 *   2. The client PUTs bytes directly to R2, tracking each part's ETag.
 *   3. completeUploadSession() — the server validates ownership + the reported
 *      parts, finalizes the multipart upload (or HEADs the single object), then
 *      creates the media row. A media record only ever exists after the bytes
 *      are confirmed in storage.
 *   4. abortUploadSession()   — aborts an in-flight multipart upload and marks
 *      the session cancelled (used on user cancel and abandoned-upload sweeps).
 *
 * R2 access keys / secret keys never leave this module. The client only ever
 * receives narrow, short-lived presigned URLs scoped to a single object/part.
 */

import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, upload_sessions } from "@/lib/db/schema";
import { config } from "@/lib/config";
import { generateId } from "@/lib/auth/codes";
import { pullVideoFromUrl } from "@/lib/services/stream";

// ─── Shared validation tables (single source of truth for uploads) ──────────

export const ALLOWED_MIME_TYPES = [
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

export const MAX_BYTES_BY_CATEGORY: Record<UploadCategory, number> = {
  image: 10 * 1024 * 1024,    // 10 MB
  video: 500 * 1024 * 1024,   // 500 MB
  audio: 50 * 1024 * 1024,    // 50 MB
  document: 25 * 1024 * 1024, // 25 MB
};

export const EXT_BY_MIME: Record<string, string> = {
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

export type UploadCategory = "image" | "video" | "audio" | "document";

export function getCategory(mime: string): UploadCategory | null {
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

// ─── Size / part policy ─────────────────────────────────────────────────────
// S3/R2 multipart requires every part except the last to be ≥ 5 MiB. We use a
// 10 MiB part (comfortably above the minimum, low enough for reliable mobile
// retries) and only take the multipart path when the file exceeds 20 MiB —
// smaller files use a single presigned PUT, which is simpler and atomic.
const MIN_PART_SIZE = 5 * 1024 * 1024;
export const DEFAULT_PART_SIZE = 10 * 1024 * 1024;
export const MULTIPART_THRESHOLD = 20 * 1024 * 1024;
export const MAX_PARTS = 10000;

export const PRESIGN_EXPIRES_SECONDS = 900; // 15 minutes
export const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

const ALLOWED_FOLDERS = ["posts", "avatars", "uploads", "documents"] as const;

export class UploadError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

function getClient(): S3Client {
  const accessKeyId = config.r2.accessKeyId();
  const secretAccessKey = config.r2.secretAccessKey();
  if (!accessKeyId || !secretAccessKey || !config.r2.bucket()) {
    throw new UploadError(500, "Cloudflare R2 credentials are not configured", "R2_NOT_CONFIGURED");
  }
  const endpoint =
    config.r2.endpoint() ??
    (() => {
      const accountId = config.r2.accountId();
      if (!accountId) throw new UploadError(500, "R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID must be set");
      return `https://${accountId}.r2.cloudflarestorage.com`;
    })();
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    // Disable automatic checksum injection — R2 rejects presigned URLs that
    // include an x-amz-checksum-* query param with a placeholder value.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function getBucket(): string {
  const bucket = config.r2.bucket();
  if (!bucket) throw new UploadError(500, "R2_BUCKET_NAME is required");
  return bucket;
}

function publicUrlForKey(key: string): string {
  const publicBase = config.r2.publicBaseUrl();
  return publicBase ? `${publicBase.replace(/\/$/, "")}/${key}` : key;
}

// ─── Session types ──────────────────────────────────────────────────────────

export interface UploadSessionRow {
  id: string;
  user_id: string;
  key: string;
  folder: string;
  type: UploadCategory;
  mime_type: string;
  file_name: string | null;
  size_bytes: number | null;
  upload_id: string | null;
  part_size: number | null;
  part_count: number | null;
  transcode: boolean;
  status: string;
  media_id: string | null;
  expires_at: string;
}

export interface CreateSessionInput {
  mimeType: string;
  fileName?: string | null;
  sizeBytes?: number | null;
  folder?: string;
  transcode?: boolean;
}

export interface UploadPart {
  partNumber: number;
  etag: string;
}

// ─── Load + ownership helpers ───────────────────────────────────────────────

async function loadSession(
  userId: string,
  sessionId: string,
): Promise<UploadSessionRow> {
  const [row] = await db
    .select()
    .from(upload_sessions)
    .where(eq(upload_sessions.id, sessionId))
    .limit(1);
  if (!row) throw new UploadError(404, "Upload session not found", "SESSION_NOT_FOUND");
  if (row.user_id !== userId) {
    throw new UploadError(403, "You may not access another user's upload session", "FORBIDDEN");
  }
  return row as unknown as UploadSessionRow;
}

function assertSessionActive(row: UploadSessionRow): void {
  if (row.status === "completed") {
    throw new UploadError(409, "Upload session already completed", "SESSION_COMPLETED");
  }
  if (row.status === "cancelled") {
    throw new UploadError(409, "Upload session was cancelled", "SESSION_CANCELLED");
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new UploadError(410, "Upload session expired — please start a new upload", "SESSION_EXPIRED");
  }
}

// ─── Create session ─────────────────────────────────────────────────────────

export async function createUploadSession(
  userId: string,
  input: CreateSessionInput,
): Promise<Record<string, unknown>> {
  const mime = input.mimeType;
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new UploadError(
      422,
      `Unsupported mime type. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
      "UNSUPPORTED_MIME",
    );
  }

  const category = getCategory(mime)!;
  const maxBytes = MAX_BYTES_BY_CATEGORY[category];
  const sizeBytes = input.sizeBytes ?? null;
  if (sizeBytes != null) {
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new UploadError(422, "size_bytes must be a positive integer", "INVALID_SIZE");
    }
    if (sizeBytes > maxBytes) {
      throw new UploadError(
        413,
        `File too large. Max for ${category}: ${maxBytes / 1024 / 1024} MB`,
        "FILE_TOO_LARGE",
      );
    }
  }

  const folderRaw = (input.folder ?? "posts").replace(/[^a-z0-9_-]/gi, "");
  const folder = (ALLOWED_FOLDERS as readonly string[]).includes(folderRaw) ? folderRaw : "posts";
  const ext = EXT_BY_MIME[mime] ?? "bin";
  const key = `${folder}/${userId}/${crypto.randomUUID()}.${ext}`;

  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const bucket = getBucket();

  const base = {
    id: sessionId,
    user_id: userId,
    key,
    folder,
    type: category,
    mime_type: mime,
    file_name: input.fileName ?? null,
    size_bytes: sizeBytes,
    transcode: input.transcode === true,
    expires_at: expiresAt,
  };

  // ── Multipart path (large files) ──────────────────────────────────────────
  const useMultipart = sizeBytes != null && sizeBytes > MULTIPART_THRESHOLD;
  if (useMultipart) {
    const partSize = DEFAULT_PART_SIZE;
    const partCount = Math.max(1, Math.ceil(sizeBytes! / partSize));
    if (partCount > MAX_PARTS) {
      throw new UploadError(413, "File too large to upload in parts", "FILE_TOO_LARGE");
    }

    const created = await getClient().send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: mime,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw new UploadError(502, "Failed to create multipart upload", "R2_ERROR");

    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, i) => {
        const partNumber = i + 1;
        const uploadUrl = await getSignedUrl(
          getClient(),
          new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
          { expiresIn: PRESIGN_EXPIRES_SECONDS },
        );
        return { partNumber, uploadUrl };
      }),
    );

    await db.insert(upload_sessions).values({
      ...base,
      upload_id: uploadId,
      part_size: partSize,
      part_count: partCount,
    });

    return {
      id: sessionId,
      key,
      mode: "multipart",
      upload_id: uploadId,
      part_size: partSize,
      part_count: partCount,
      parts,
      expires_in: PRESIGN_EXPIRES_SECONDS,
      session_expires_in: SESSION_TTL_SECONDS,
      max_bytes: maxBytes,
    };
  }

  // ── Single PUT path (small files) ─────────────────────────────────────────
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }),
    { expiresIn: PRESIGN_EXPIRES_SECONDS },
  );

  await db.insert(upload_sessions).values({
    ...base,
    upload_id: null,
    part_size: null,
    part_count: null,
  });

  return {
    id: sessionId,
    key,
    mode: "single",
    upload_url: uploadUrl,
    expires_in: PRESIGN_EXPIRES_SECONDS,
    session_expires_in: SESSION_TTL_SECONDS,
    max_bytes: maxBytes,
  };
}

// ─── Re-issue a part URL (resume / expired URL recovery) ────────────────────

export async function presignPartUrl(
  userId: string,
  sessionId: string,
  partNumber: number,
): Promise<{ partNumber: number; uploadUrl: string }> {
  const session = await loadSession(userId, sessionId);
  assertSessionActive(session);
  if (!session.upload_id || !session.part_count) {
    throw new UploadError(409, "This upload is not a multipart upload", "NOT_MULTIPART");
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.part_count) {
    throw new UploadError(422, `partNumber must be between 1 and ${session.part_count}`, "INVALID_PART");
  }

  const uploadUrl = await getSignedUrl(
    getClient(),
    new UploadPartCommand({
      Bucket: getBucket(),
      Key: session.key,
      UploadId: session.upload_id,
      PartNumber: partNumber,
    }),
    { expiresIn: PRESIGN_EXPIRES_SECONDS },
  );

  // First part upload marks the session as actively uploading.
  if (session.status === "pending") {
    await db
      .update(upload_sessions)
      .set({ status: "uploading" })
      .where(eq(upload_sessions.id, sessionId));
  }

  return { partNumber, uploadUrl };
}

// ─── Finalize + create media record ─────────────────────────────────────────

export async function completeUploadSession(
  userId: string,
  sessionId: string,
  parts: UploadPart[],
  postId?: string | null,
): Promise<Record<string, unknown>> {
  const session = await loadSession(userId, sessionId);

  // Idempotency: a duplicate completion returns the already-created media row
  // instead of creating a second record.
  if (session.status === "completed" && session.media_id) {
    const [row] = await db.select().from(media).where(eq(media.id, session.media_id)).limit(1);
    if (row) return mediaResponse(row, session.key, session.type, session.mime_type, session.size_bytes);
  }
  assertSessionActive(session);

  const bucket = getBucket();

  try {
    if (session.upload_id) {
      // Multipart: validate + complete server-side.
      const validated = validateParts(parts, session.part_count);
      await getClient().send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: session.key,
          UploadId: session.upload_id,
          MultipartUpload: {
            Parts: validated.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    } else {
      // Single PUT: confirm the object actually landed in R2 before recording it.
      try {
        await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: session.key }));
      } catch {
        throw new UploadError(409, "Object not found in storage — please re-upload", "OBJECT_NOT_FOUND");
      }
    }
  } catch (e) {
    if (e instanceof UploadError) throw e;
    console.error(`[uploads] finalize failed for ${session.id}:`, e);
    await db
      .update(upload_sessions)
      .set({ status: "failed" })
      .where(eq(upload_sessions.id, sessionId));
    throw new UploadError(502, "Failed to finalize upload in storage", "FINALIZE_FAILED");
  }

  const mediaRow = await createMediaRecord(session, postId);
  return mediaResponse(mediaRow, session.key, session.type, session.mime_type, session.size_bytes);
}

function validateParts(parts: UploadPart[], expectedCount: number | null): UploadPart[] {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new UploadError(422, "parts array is required to complete a multipart upload", "PARTS_REQUIRED");
  }
  if (expectedCount != null && parts.length !== expectedCount) {
    throw new UploadError(
      422,
      `Expected ${expectedCount} parts but received ${parts.length}`,
      "PART_COUNT_MISMATCH",
    );
  }

  const seen = new Set<number>();
  const normalized: UploadPart[] = [];
  for (const p of parts) {
    const n = typeof p?.partNumber === "number" ? p.partNumber : parseInt(String(p?.partNumber), 10);
    const etag = typeof p?.etag === "string" ? p.etag.trim() : "";
    if (!Number.isInteger(n) || n < 1) {
      throw new UploadError(422, "Each part must have a valid partNumber", "INVALID_PART");
    }
    if (!etag) {
      throw new UploadError(422, `Part ${n} is missing its ETag`, "MISSING_ETAG");
    }
    if (seen.has(n)) {
      throw new UploadError(422, `Duplicate partNumber ${n}`, "DUPLICATE_PART");
    }
    seen.add(n);
    normalized.push({ partNumber: n, etag });
  }
  normalized.sort((a, b) => a.partNumber - b.partNumber);
  return normalized;
}

async function createMediaRecord(session: UploadSessionRow, postId?: string | null) {
  const mediaId = generateId();
  const url = publicUrlForKey(session.key);

  const [row] = await db
    .insert(media)
    .values({
      id: mediaId,
      uploader_id: session.user_id,
      post_id: postId ?? null,
      url,
      blob_path: session.key,
      type: session.type,
      mime_type: session.mime_type,
      size_bytes: session.size_bytes,
      file_name: session.file_name,
    })
    .returning();

  await db
    .update(upload_sessions)
    .set({ status: "completed", media_id: mediaId })
    .where(eq(upload_sessions.id, session.id));

  // Long-form video: kick off Cloudflare Stream transcoding (fire-and-forget).
  if (session.type === "video" && session.transcode) {
    const sourceUrl = config.r2.publicBaseUrl()
      ? publicUrlForKey(session.key)
      : null;
    if (sourceUrl) {
      pullVideoFromUrl(sourceUrl, {
        mediaId,
        uploaderId: session.user_id,
        postId: postId ?? null,
      })
        .then((res) => {
          if (!res) return;
          return db
            .update(media)
            .set({ stream_uid: res.uid, stream_status: "processing" })
            .where(eq(media.id, mediaId));
        })
        .catch((e) => console.error("[uploads] stream kickoff failed:", e));
    }
  }

  return row;
}

function mediaResponse(
  row: { id: string; url: string },
  key: string,
  type: string,
  mimeType: string,
  sizeBytes: number | null,
): Record<string, unknown> {
  return {
    media: { id: row.id, url: row.url, type, mime_type: mimeType, size_bytes: sizeBytes },
    // Top-level aliases — the mobile uploadMedia reads resp.url / resp.id directly.
    id: row.id,
    media_id: row.id,
    url: row.url,
    media_type: type,
    key,
  };
}

// ─── Abort / cancel ─────────────────────────────────────────────────────────

export async function abortUploadSession(userId: string, sessionId: string): Promise<void> {
  const session = await loadSession(userId, sessionId);
  if (session.status === "completed" || session.status === "cancelled") return;

  if (session.upload_id) {
    try {
      await getClient().send(
        new AbortMultipartUploadCommand({
          Bucket: getBucket(),
          Key: session.key,
          UploadId: session.upload_id,
        }),
      );
    } catch (e) {
      // Best-effort — a vanished multipart upload is already gone.
      console.warn(`[uploads] abort multipart failed for ${session.id}:`, e);
    }
  }

  await db
    .update(upload_sessions)
    .set({ status: "cancelled" })
    .where(eq(upload_sessions.id, sessionId));
}

export async function getUploadSession(userId: string, sessionId: string) {
  const session = await loadSession(userId, sessionId);
  return {
    id: session.id,
    key: session.key,
    status: session.status,
    mode: session.upload_id ? "multipart" : "single",
    part_size: session.part_size,
    part_count: session.part_count,
    size_bytes: session.size_bytes,
    mime_type: session.mime_type,
    media_id: session.media_id,
    expires_at: session.expires_at,
  };
}
