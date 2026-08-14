import { NextRequest } from "next/server";
import { ok, err } from "@/lib/api/response";
import { listRoomReplies } from "@/lib/services/comment-rooms";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  const replies = await listRoomReplies(id, commentId);
  return ok({ replies });
}
