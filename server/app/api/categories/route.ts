import { NextRequest } from "next/server";
import { asc, eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, post_categories, posts } from "@/lib/db/schema";
import { ok } from "@/lib/api/response";

export async function GET(_req: NextRequest) {
  // `categories.post_count` is a denormalized column that is never maintained
  // (always seeded 0). The authoritative count lives in the post_categories
  // join table → posts. Compute it live so Explore reflects real category
  // content instead of a permanently-zero counter.
  const rows = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .orderBy(asc(categories.name));

  const counts = await db
    .select({ category_id: post_categories.category_id, n: sql<number>`count(*)` })
    .from(post_categories)
    .innerJoin(posts, eq(posts.id, post_categories.post_id))
    .where(and(eq(posts.status, "published"), isNull(posts.deleted_at)))
    .groupBy(post_categories.category_id);

  const countByCategory = new Map<string, number>();
  for (const c of counts) {
    countByCategory.set(c.category_id, Number(c.n ?? 0));
  }

  return ok({
    categories: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      post_count: countByCategory.get(r.id) ?? 0,
    })),
  });
}
