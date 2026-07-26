import {
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "@/lib/config";

// ─── Client factory ─────────────────────────────────────────────────────────

function getClient(): S3Client {
  const accountId = config.r2.accountId();
  const accessKeyId = config.r2.accessKeyId();
  const secretAccessKey = config.r2.secretAccessKey();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Cloudflare R2 credentials are not configured",
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  const bucket = config.r2.bucket();
  if (!bucket) throw new Error("R2_BUCKET_NAME is required");
  return bucket;
}

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

