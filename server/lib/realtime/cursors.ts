import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { realtime_cursors } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import { sql } from "drizzle-orm";

let ready: Promise<void> | null = null;

/** Runtime-safe migration for deployments without checked-in SQL migrations. */
export function ensureRealtimeCursorSchema(): Promise<void> {
  ready ??= (async () => {
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS realtime_cursors (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        last_ack_sequence INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE(user_id, client_id)
      )
    `).catch(() => {});
  })();
  return ready;
}

export async function readCursor(userId: string, clientId: string): Promise<number> {
  await ensureRealtimeCursorSchema();
  const [row] = await db
    .select({ sequence: realtime_cursors.last_ack_sequence })
    .from(realtime_cursors)
    .where(and(eq(realtime_cursors.user_id, userId), eq(realtime_cursors.client_id, clientId)))
    .limit(1);
  return Number(row?.sequence ?? 0);
}

export async function acknowledgeCursor(userId: string, clientId: string, sequence: number): Promise<number> {
  await ensureRealtimeCursorSchema();
  const current = await readCursor(userId, clientId);
  const next = Math.max(current, Math.max(0, Math.floor(sequence)));
  if (next === current) return current;

  const existing = await db
    .select({ id: realtime_cursors.id })
    .from(realtime_cursors)
    .where(and(eq(realtime_cursors.user_id, userId), eq(realtime_cursors.client_id, clientId)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(realtime_cursors)
      .set({ last_ack_sequence: next, updated_at: new Date().toISOString() })
      .where(eq(realtime_cursors.id, existing[0].id));
  } else {
    await db.insert(realtime_cursors).values({
      id: generateId(),
      user_id: userId,
      client_id: clientId,
      last_ack_sequence: next,
      updated_at: new Date().toISOString(),
    }).onConflictDoNothing();
  }
  return next;
}
