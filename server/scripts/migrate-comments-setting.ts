/**
 * migrate-comments-setting.ts
 *
 * Adds `user_settings.allow_comments` (default 1) to the LIVE Turso database —
 * the "Comments" privacy control: when OFF, nobody can comment on this user's
 * posts (server-enforced at comment creation).
 *
 * Idempotent: the ALTER is skipped when the column already exists. No existing
 * data is touched.
 *
 * Usage:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... pnpm exec tsx scripts/migrate-comments-setting.ts
 */
import { createClient } from "@libsql/client";
import { config } from "@/lib/config";

const url = config.turso.url();
const token = config.turso.token();
if (!url || !token) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are required");

const client = createClient({ url, authToken: token });

async function main() {
  const tx = await client.transaction("write");
  try {
    const r = await tx.execute(`PRAGMA table_info(user_settings)`);
    const cols = r.rows.map((row) => String(row.name));

    if (!cols.includes("allow_comments")) {
      await tx.execute("ALTER TABLE user_settings ADD COLUMN allow_comments INTEGER NOT NULL DEFAULT 1");
      console.log("[migrate] user_settings.allow_comments added");
    } else {
      console.log("[migrate] user_settings.allow_comments exists — skipped");
    }

    await tx.commit();
    console.log("[migrate] COMMITTED");
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* ignore rollback failure */
    }
    console.error("[migrate] FAILED — rolled back:", error);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.close());
