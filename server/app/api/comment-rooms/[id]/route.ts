import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { ok, err } from "@/lib/api/response";
import { getCommentRoom } from "@/lib/services/comment-rooms";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!post) return err("Post not found", 404);

  const room = await getCommentRoom(id);
  if (!room) return err("Comment room not found", 404);

  return ok({ comment_room: room, commentRoom: room });
}
