import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { ok, err } from "@/lib/api/response";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) return err("Post not found", 404);

  // `posts.view_count` is the single authoritative view counter (the legacy
  // post_views row table was write-only and never read).
  await db.update(posts).set({ view_count: sql`${posts.view_count} + 1` }).where(eq(posts.id, id));

  return ok({ viewed: true });
}
