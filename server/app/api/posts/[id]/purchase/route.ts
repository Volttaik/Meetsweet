import { NextRequest } from "next/server";
import { err } from "@/lib/api/response";

/**
 * POST /api/posts/:id/purchase
 *
 * Per-post purchasing has been removed from the platform.
 * Content access is now gated by subscriptions only.
 * Returns 410 Gone for client compatibility.
 */
export async function POST(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
) {
  return err(
    "Per-post purchasing is no longer supported. Subscribe to a creator to access their content.",
    410,
    "FEATURE_REMOVED",
  );
}
