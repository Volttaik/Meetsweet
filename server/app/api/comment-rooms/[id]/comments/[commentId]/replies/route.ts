import { NextRequest } from "next/server";
import { ok } from "@/lib/api/response";
import { optionalAuth } from "@/middleware/auth";
import { listCommentThread } from "@/lib/services/comment-rooms";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  // The full descendant subtree (every reply depth), flat, each row carrying
  // its exact parentId so the client can rebuild the thread tree.
  const viewer = await optionalAuth(req);
  const replies = await listCommentThread(id, commentId, viewer?.userId ?? null);
  return ok({ replies });
}
