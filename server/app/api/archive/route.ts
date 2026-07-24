import { NextRequest } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { archives, posts, media } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const rows = await db
    .select({
      id: archives.id,
      archived_at: archives.archived_at,
      price: archives.price,
      is_purchasable: archives.is_purchasable,
      post_id: posts.id,
      caption: posts.caption,
      view_count: posts.view_count,
      like_count: posts.like_count,
      comment_count: posts.comment_count,
      created_at: posts.created_at,
    })
    .from(archives)
    .leftJoin(posts, eq(posts.id, archives.post_id))
    .where(eq(archives.creator_id, auth.user.userId))
    .orderBy(desc(archives.archived_at));

  return ok(rows);
}
