import { NextRequest } from "next/server";
import { optionalAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { listRoomComments } from "@/lib/services/comment-rooms";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const since = req.nextUrl.searchParams.get("since") ?? undefined;

  // No marker yet → nothing to report (the client uses the initial list).
  if (!since) {
    return ok({ changed: false, marker: null, comments: [] });
  }

  const viewer = await optionalAuth(req);
  const commentsList = await listRoomComments(id, { after: since, viewerId: viewer?.userId ?? null });

  return ok({
    changed: commentsList.length > 0,
    marker: new Date().toISOString(),
    comments: commentsList,
  });
}
