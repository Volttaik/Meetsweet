/**
 * Seed the categories table with the standard MeetSweet content categories.
 * Run with: npx tsx scripts/seed-categories.ts
 *
 * Idempotent — skips categories that already exist (matched by slug).
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { categories } from "../lib/db/schema";

const CATEGORIES = [
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

function randomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error("TURSO_DATABASE_URL is not set");
    process.exit(1);
  }

  const client = createClient({ url, authToken });
  const db2 = drizzle(client, { schema: { categories } });

  let inserted = 0;
  let skipped = 0;

  for (const cat of CATEGORIES) {
    const existing = await db2
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, cat.slug))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await db2.insert(categories).values({
      id: randomId(),
      name: cat.name,
      slug: cat.slug,
      post_count: 0,
    });
    inserted++;
    console.log(`  ✓ Inserted: ${cat.name}`);
  }

  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped} (already existed).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
