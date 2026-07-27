import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db
    .select({ id: posts.id, creator_id: posts.creator_id })
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return err("Post not found", 404);
  if (post.creator_id !== auth.user.userId) return err("Forbidden", 403);

  const now = new Date().toISOString();
  await db
    .update(posts)
    .set({ status: "published", visibility: "public", published_at: now, updated_at: now })
    .where(eq(posts.id, id));

  return ok({ restored: true });
}
