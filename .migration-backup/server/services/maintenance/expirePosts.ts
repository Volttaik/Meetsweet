import { lt, eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, archives } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";

export interface ExpirePostsResult {
  archived: number;
}

/**
 * Find published posts whose `expires_at` has passed and move them to the
 * archives table.
 */
export async function expirePosts(): Promise<ExpirePostsResult> {
  const now = new Date().toISOString();

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

  if (!expired.length) return { archived: 0 };

  for (const post of expired) {
    await db
      .update(posts)
      .set({ status: "archived", updated_at: now })
      .where(eq(posts.id, post.id));

    await db
      .insert(archives)
      .values({
        id: generateId(),
        post_id: post.id,
        creator_id: post.creator_id,
      })
      .onConflictDoNothing();
  }

  return { archived: expired.length };
}
