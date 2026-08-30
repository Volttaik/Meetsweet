import {
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "@/lib/config";

// ─── R2 endpoint ────────────────────────────────────────────────────────────
// Cloudflare R2 only supports PATH-STYLE addressing:
//   https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
// Virtual-hosted style (https://<bucket>.<account>.r2.cloudflarestorage.com/…)
// is NOT served by Cloudflare — requests to that host are rejected (400/403,
// or DNS resolution failure on some client networks). Every S3 client in this
// codebase must set `forcePathStyle: true` so the URLs it produces carry the
// path-style host. This is what previously made media URLs handed to the app
// fail with host-resolution errors ("Unable to resolve host …r2.cloudflare-
// storage.com") when the public bucket domain was not configured.
export function r2Endpoint(): string {
  const explicit = config.r2.endpoint();
  if (explicit) return explicit.replace(/\/+$/, "");
  const accountId = config.r2.accountId();
  if (!accountId) {
    throw new Error("R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID must be set");
  }
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

// ─── Client factory ─────────────────────────────────────────────────────────

function getClient(): S3Client {
  const accessKeyId = config.r2.accessKeyId();
  const secretAccessKey = config.r2.secretAccessKey();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Cloudflare R2 credentials are not configured",
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: r2Endpoint(),
    credentials: { accessKeyId, secretAccessKey },
    // R2 uses path-style URLs: <account>.r2.cloudflarestorage.com/<bucket>/...
    // Virtual-hosted style (bucket as subdomain) returns 403 AccessDenied.
    forcePathStyle: true,
    // Disable automatic checksum injection — R2 rejects presigned URLs that
    // include an x-amz-checksum-* query param with a placeholder value.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function getBucket(): string {
  const bucket = config.r2.bucket();
  if (!bucket) throw new Error("R2_BUCKET_NAME is required");
  return bucket;
}

// ─── Public media URL (single source of truth) ──────────────────────────────
// The bucket's public domain (R2_PUBLIC_BASE_URL, e.g. https://pub-….r2.dev)
// is the ONLY host served to clients. The raw S3 endpoint
// (<account>.r2.cloudflarestorage.com) is private infrastructure — it is used
// for signing and object operations, never handed to the mobile app.

/** Normalized public bucket base URL, or null when R2_PUBLIC_BASE_URL is unset. */
export function publicBaseUrl(): string | null {
  const base = config.r2.publicBaseUrl();
  return base ? base.replace(/\/+$/, "") : null;
}

/** Public URL for an object key via the configured bucket domain. */
export function publicUrlForKey(key: string | null | undefined): string | null {
  const base = publicBaseUrl();
  if (!base || !key) return null;
  return `${base}/${key.replace(/^\/+/, "")}`;
}

/**
 * Build the client-playable URL for an R2 object — the ONE function that
 * produces media URLs returned to the app.
 *
 * 1. When R2_PUBLIC_BASE_URL is configured, return `https://<public-domain>/<key>`
 *    — stable, cacheable, no expiry.
 * 2. Otherwise fall back to a short-lived, correctly path-style presigned GET
 *    URL so the media is still a fully resolvable https URL instead of a bare
 *    key. Callers should log a loud warning: presigned URLs expire and are not
 *    a production substitute for the public bucket domain.
 */
export async function resolvePublicUrl(
  key: string | null | undefined,
  expiresIn = 604800,
): Promise<string | null> {
  const publicUrl = publicUrlForKey(key);
  if (publicUrl) return publicUrl;
  return resolveUrl(key, expiresIn);
}

// ─── Signed URL helpers (explicit signed access) ────────────────────────────

export async function resolveUrl(
  keyOrUrl: string | null | undefined,
  expiresIn = 604800
): Promise<string | null> {
  if (!keyOrUrl) return null;
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: getBucket(), Key: keyOrUrl }),
    { expiresIn }
  );
}

export async function resolveUrls(
  keys: (string | null | undefined)[]
): Promise<(string | null)[]> {
  return Promise.all(keys.map((k) => resolveUrl(k)));
}
