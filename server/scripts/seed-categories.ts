/**
 * One-time seed: insert the default categories into the database.
 * Run with: cd server && pnpm tsx scripts/seed-categories.ts
 *
 * Safe to run multiple times — uses INSERT OR IGNORE.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import * as schema from "../lib/db/schema";

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

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL is required");

  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });

  for (const cat of CATEGORIES) {
    await db.run(
      sql`INSERT OR IGNORE INTO categories (id, name, slug) VALUES (lower(hex(randomblob(16))), ${cat.name}, ${cat.slug})`
    );
  }

  console.log(`✅ Seeded ${CATEGORIES.length} categories.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
