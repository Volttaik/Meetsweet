import { NextRequest, NextResponse } from "next/server";
import { lt, eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, archives } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

// Called by Vercel Cron — secured with CRON_SECRET header
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization");
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();

  // Find published posts whose expires_at has passed
  const expired = await db
    .select({ id: posts.id, creator_id: posts.creator_id })
    .from(posts)
    .where(
      and(
        eq(posts.status, "published"),
        lt(posts.expires_at, now),
        isNull(posts.deleted_at)
      )
    );

  if (!expired.length) {
    return NextResponse.json({ ok: true, archived: 0 });
  }

  // Archive each expired post
  for (const post of expired) {
    await db
      .update(posts)
      .set({ status: "archived", updated_at: now })
      .where(eq(posts.id, post.id));

    await db.insert(archives).values({
      id: generateId(),
      post_id: post.id,
      creator_id: post.creator_id,
    }).onConflictDoNothing();
  }

  console.log(`[cron/expire-posts] archived ${expired.length} posts`);
  return NextResponse.json({ ok: true, archived: expired.length });
}
