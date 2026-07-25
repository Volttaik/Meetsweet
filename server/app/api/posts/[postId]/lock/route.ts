import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, forbidden, notFound } from "@/lib/api/response";
import { z } from "zod";

const schema = z.object({
  unlock_price: z.number().nonnegative(),
  visibility: z.enum(["subscribers", "private"]).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { postId } = await params;

  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deleted_at)))
    .limit(1);

  if (!post) return notFound();
  if (post.creator_id !== auth.user.userId) return forbidden();

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  await db
    .update(posts)
    .set({
      unlock_price: parsed.data.unlock_price,
      visibility: parsed.data.visibility ?? "subscribers",
      updated_at: new Date().toISOString(),
    })
    .where(eq(posts.id, postId));

  return ok(null, "Post locked");
}
