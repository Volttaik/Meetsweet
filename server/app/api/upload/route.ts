import { NextRequest } from "next/server";
import { err } from "@/lib/api/response";

/**
 * POST /api/upload (legacy)
 *
 * This endpoint previously accepted the entire media file as a multipart
 * request body and proxied it to R2. That architecture hit the Vercel
 * serverless request-body limit (HTTP 413 Payload Too Large) for any file
 * above a few MB, so it has been removed.
 *
 * Media must now be uploaded directly to R2 via the authorized upload-session
 * flow:
 *   POST /api/uploads            → authorize (presigned PUT or multipart parts)
 *   PUT  <presigned URL>         → upload bytes directly to R2
 *   POST /api/uploads/:id/complete → finalize + create the media record
 */
export async function POST(_req: NextRequest) {
  return err(
    "This upload endpoint has been removed. Upload media directly to storage via POST /api/uploads followed by POST /api/uploads/:id/complete.",
    410,
    "UPLOAD_PATH_REMOVED",
  );
}
