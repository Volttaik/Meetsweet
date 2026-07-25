import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { ok } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { sql } from "drizzle-orm";

const SEED_CATEGORIES = [
  { name: "Lifestyle", slug: "lifestyle" },
  { name: "Fashion", slug: "fashion" },
  { name: "Fitness", slug: "fitness" },
  { name: "Photography", slug: "photography" },
  { name: "Gaming", slug: "gaming" },
  { name: "Music", slug: "music" },
  { name: "Dance", slug: "dance" },
  { name: "Comedy", slug: "comedy" },
  { name: "Education", slug: "education" },
  { name: "Art", slug: "art" },
  { name: "Cooking", slug: "cooking" },
  { name: "Travel", slug: "travel" },
  { name: "Technology", slug: "technology" },
  { name: "Models", slug: "models" },
  { name: "Behind the Scenes", slug: "behind-the-scenes" },
  { name: "Luxury", slug: "luxury" },
];

export async function GET(_req: NextRequest) {
  // Lazy seed — insert missing categories on first request
  await db
    .insert(categories)
    .values(
      SEED_CATEGORIES.map((c) => ({
        id: generateId(),
        name: c.name,
        slug: c.slug,
      }))
    )
    .onConflictDoNothing();

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      postCount: categories.post_count,
    })
    .from(categories);

  return ok({ categories: rows });
}
