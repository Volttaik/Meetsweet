/**
 * Cleanup script for abandoned direct-to-storage upload sessions.
 *
 * R2 multipart uploads are billable and accumulate if a client never calls
 * complete (network loss, app kill, cancellation). This script finds sessions
 * that are still pending/uploading but past their expiry (or older than a
 * grace window), aborts the underlying R2 multipart upload, and marks them
 * cancelled. No media record exists for these, so there is nothing to unwind
 * in the content tables.
 *
 * Run with:
 *   cd server && npx tsx scripts/cleanup-uploads.ts
 *
 * Safe to run repeatedly. Never touches completed sessions.
 */

import { AbortMultipartUploadCommand, S3Client } from "@aws-sdk/client-s3";
import { and, inArray, lt, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { upload_sessions } from "../lib/db/schema";
import { config } from "../lib/config";

function getClient(): S3Client | null {
  const accessKeyId = config.r2.accessKeyId();
  const secretAccessKey = config.r2.secretAccessKey();
  if (!accessKeyId || !secretAccessKey || !config.r2.bucket()) return null;
  const endpoint =
    config.r2.endpoint() ??
    (config.r2.accountId() ? `https://${config.r2.accountId()}.r2.cloudflarestorage.com` : null);
  if (!endpoint) return null;
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

async function run() {
  const client = getClient();
  const bucket = config.r2.bucket();
  const now = new Date().toISOString();

  const stale = await db
    .select()
    .from(upload_sessions)
    .where(
      and(
        inArray(upload_sessions.status, ["pending", "uploading", "failed"]),
        lt(upload_sessions.expires_at, now),
      ),
    );

  let aborted = 0;
  for (const s of stale) {
    if (s.upload_id && client && bucket) {
      try {
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: s.key,
            UploadId: s.upload_id,
          }),
        );
        aborted++;
      } catch (e) {
        console.warn(`  ─  abort multipart failed for ${s.id}:`, e instanceof Error ? e.message : e);
      }
    }
    await db
      .update(upload_sessions)
      .set({ status: "cancelled" })
      .where(eq(upload_sessions.id, s.id));
  }

  console.log(`Cleanup complete: ${stale.length} stale session(s), ${aborted} multipart upload(s) aborted.`);
  process.exit(0);
}

run().catch((e) => {
  console.error("Cleanup failed:", e);
  process.exit(1);
});
