/**
 * Durable realtime outbox on Turso.
 *
 * Every durable event is appended here with a monotonic `seq` before it is
 * fanned out. This is what makes the system survive Vercel's connection
 * lifecycle: sockets close at max duration and reconnects can land on a
 * different instance (per vercel.com/docs/functions/websockets), but no event
 * is ever lost — clients replay their channel's events since the last seq
 * they saw (`sync`). The table self-initializes so no manual production
 * migration is required.
 */

import { and, asc, eq, gt, inArray, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { realtime_events } from "@/lib/db/schema";
import { generateId } from "@/lib/auth/codes";
import type { EmitInput, RealtimeEvent } from "./types";

let ensured = false;

/** Create the realtime_events table if it does not exist (once per instance). */
export async function ensureRealtimeSchema(): Promise<void> {
  if (ensured) return;
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS realtime_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      user_id TEXT,
      resource_id TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS realtime_events_channel_seq_idx ON realtime_events (channel, seq)`,
  );
  ensured = true;
}

/**
 * Append an event to the durable outbox and return the full envelope with
 * its assigned seq.
 */
export async function appendEvent(input: EmitInput): Promise<RealtimeEvent> {
  await ensureRealtimeSchema();
  const id = generateId();
  const ts = new Date().toISOString();

  const [row] = await db
    .insert(realtime_events)
    .values({
      id,
      type: input.type,
      channel: input.channel,
      user_id: input.userId,
      resource_id: input.resourceId ?? null,
      payload: JSON.stringify(input.payload),
    })
    .returning({ seq: realtime_events.seq });

  return {
    id,
    seq: Number(row?.seq ?? 0),
    type: input.type,
    channel: input.channel,
    ts,
    resourceId: input.resourceId ?? null,
    payload: input.payload,
  };
}

/**
 * Replay every durable event on the given channels newer than `since`.
 * Ordered by seq ascending; capped to keep one replay bounded — the client
 * re-syncs if it is still behind.
 */
export async function eventsSince(
  channels: string[],
  since: number,
  limit = 200,
): Promise<RealtimeEvent[]> {
  if (channels.length === 0) return [];
  await ensureRealtimeSchema();

  const rows = await db
    .select()
    .from(realtime_events)
    .where(
      and(
        inArray(realtime_events.channel, channels),
        gt(realtime_events.seq, Math.max(0, Math.floor(since))),
      ),
    )
    .orderBy(asc(realtime_events.seq))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    seq: Number(r.seq),
    type: r.type as RealtimeEvent["type"],
    channel: r.channel,
    ts: r.created_at,
    resourceId: r.resource_id,
    payload: JSON.parse(r.payload),
  }));
}

/**
 * All durable events on ONE channel newer than `since` (used by authorized
 * replay when a client syncs).
 */
export async function eventsForUserSince(
  userId: string,
  since: number,
  limit = 200,
): Promise<RealtimeEvent[]> {
  await ensureRealtimeSchema();
  const rows = await db
    .select()
    .from(realtime_events)
    .where(and(eq(realtime_events.user_id, userId), gt(realtime_events.seq, Math.max(0, Math.floor(since)))))
    .orderBy(asc(realtime_events.seq))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    seq: Number(r.seq),
    type: r.type as RealtimeEvent["type"],
    channel: r.channel,
    ts: r.created_at,
    resourceId: r.resource_id,
    payload: JSON.parse(r.payload),
  }));
}

/** Current head of the outbox (0 when empty). */
export async function currentSeq(): Promise<number> {
  await ensureRealtimeSchema();
  const [row] = await db
    .select({ head: max(realtime_events.seq) })
    .from(realtime_events);
  return Number(row?.head ?? 0);
}

/**
 * Prune old events. Called opportunistically after appends — the outbox only
 * needs to cover reasonable reconnect windows, not forever.
 */
export async function pruneEvents(olderThanDays = 7): Promise<void> {
  await ensureRealtimeSchema();
  await db.delete(realtime_events).where(
    sql`${realtime_events.created_at} < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${`-${olderThanDays} days`})`,
  );
}
