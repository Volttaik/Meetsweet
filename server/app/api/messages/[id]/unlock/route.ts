import { NextRequest } from "next/server";
import { err } from "@/lib/api/response";

/**
 * POST /api/messages/:id/unlock
 *
 * Paid DM content has been removed from the platform.
 * All messages are freely visible to conversation members.
 * This endpoint is retained for client compatibility and returns 410 Gone.
 */
export async function POST(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
) {
  return err("Paid DM content is no longer supported. Messages are freely accessible to all conversation members.", 410, "FEATURE_REMOVED");
}
