import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, post_views } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) return err("Post not found", 404);

  let userId: string | null = null;
  const authResult = await requireAuth(req);
  if (!("response" in authResult)) {
    userId = authResult.user.userId;
  }

  await db.insert(post_views).values({ id: generateId(), post_id: id, user_id: userId });
  await db.update(posts).set({ view_count: sql`${posts.view_count} + 1` }).where(eq(posts.id, id));

  return ok({ viewed: true });
}
