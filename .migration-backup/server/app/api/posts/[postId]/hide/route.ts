import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hidden_posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  await db.insert(hidden_posts).values({
    id: generateId(),
    user_id: auth.user.userId,
    post_id: postId,
  }).onConflictDoNothing();

  return ok(null, "Post hidden");
}
