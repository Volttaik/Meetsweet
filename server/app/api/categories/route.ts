import { NextRequest } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { ok } from "@/lib/api/response";

export async function GET(_req: NextRequest) {
  const rows = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug, post_count: categories.post_count })
    .from(categories)
    .orderBy(asc(categories.name));

  return ok({ categories: rows });
}
