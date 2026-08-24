/**
 * Realtime Outbox — the durable event log.
 *
 * Every DURABLE realtime event is appended here as one row with a monotonic
 * `id` (the event `seq`). The outbox serves two purposes:
 *
 *   1. MISSED-EVENT RECOVERY — Vercel pins a WebSocket to one Function
 *      instance and closes it at the function max duration. When a client
 *      reconnects (possibly onto a different instance) it sends `sync` with
 *      its last seen `seq`; this module replays everything after that
 *      sequence for the channels the connection is subscribed to.
 *   2. DURABLE DELIVERY — cross-instance fan-out: an event written here can
 *      be read by any instance, so a socket that missed a live broadcast can
 *      still converge.
 *
 * The table is self-initialized at runtime (CREATE TABLE IF NOT EXISTS) so no
 * manual production migration is required — the schema declaration lives in
 * lib/db/schema.ts for type-safety and future drizzle-kit migrations.
 *
 * Ephemeral events (typing/recording/presence) are NEVER written here — they
 * are transient by design and only fan out to the emitting instance.
 */

import { and, asc, gt, inArray, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { realtime_events } from "@/lib/db/schema";
import { withTimeout } from "./timeout";
import type { RealtimeEvent } from "./types";

let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Hard ceiling for outbox queries in the realtime path. The outbox is a
 * best-effort durability layer — a message must NEVER block on it. SweetSocket
 * serializes every command on a connection, so one hung outbox write would
 * stall every subsequent message and delay the reconnect `hello` (which the
 * mobile client requires before flushing its offline command queue). When a
 * query exceeds the bound we fall back to the failure value and move on; the
 * underlying query keeps running and its eventual write is harmless (replay
 * dedupes by event id on the client).
 */
const OUTBOX_TIMEOUT_MS = 2_500;

const DDL = sql`
  CREATE TABLE IF NOT EXISTS realtime_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    channel     TEXT NOT NULL,
    resource_id TEXT,
    actor_id    TEXT,
    payload     TEXT,
    created_at  TEXT NOT NULL
  )`;

async function ensureTable(): Promise<void> {
  if (initialized) return;
  initPromise ??= (async () => {
    try {
      await db.run(DDL);
      initialized = true;
    } catch {
      // Failures are non-fatal: events degrade to per-instance broadcast only.
      initialized = false;
    }
  })();
  await initPromise;
}

/** Append a durable event; returns its outbox `seq` (null on failure). */
export async function appendOutboxEvent(event: RealtimeEvent): Promise<number | null> {
  try {
    await ensureTable();
    const rows = await withTimeout(
      db
        .insert(realtime_events)
        .values({
          event_id: event.id,
          event_type: event.type,
          channel: event.channel,
          resource_id: event.resourceId ?? null,
          actor_id: event.userId ?? null,
          payload: JSON.stringify(event.payload ?? {}),
          created_at: event.ts,
        })
        .returning({ id: realtime_events.id }),
      OUTBOX_TIMEOUT_MS,
      null,
    );
    const row = rows?.[0];
    return row ? Number(row.id) : null;
  } catch {
    return null;
  }
}

function rowToEvent(row: {
  id: number | bigint;
  event_id: string;
  event_type: string;
  channel: string;
  resource_id: string | null;
  actor_id: string | null;
  payload: string | null;
  created_at: string;
}): RealtimeEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
  } catch {
    // Malformed payload — deliver the event with empty payload rather than drop it.
  }
  return {
    id: row.event_id,
    seq: Number(row.id),
    type: row.event_type,
    channel: row.channel,
    ts: row.created_at,
    resourceId: row.resource_id ?? undefined,
    userId: row.actor_id ?? undefined,
    payload,
  };
}

/**
 * Read durable events after `seq` for the given channels (oldest first),
 * bounded by `limit`. Used by reconnect missed-event recovery.
 */
export async function readOutboxSince(
  seq: number,
  channels: string[],
  limit = 200,
): Promise<RealtimeEvent[]> {
  if (channels.length === 0) return [];
  try {
    await ensureTable();
    const query = db
      .select({
        id: realtime_events.id,
        event_id: realtime_events.event_id,
        event_type: realtime_events.event_type,
        channel: realtime_events.channel,
        resource_id: realtime_events.resource_id,
        actor_id: realtime_events.actor_id,
        payload: realtime_events.payload,
        created_at: realtime_events.created_at,
      })
      .from(realtime_events)
      .where(and(gt(realtime_events.id, seq), inArray(realtime_events.channel, channels)))
      .orderBy(asc(realtime_events.id))
      .limit(limit);
    const rows = await withTimeout(query, OUTBOX_TIMEOUT_MS, []);
    return rows.map(rowToEvent);
  } catch {
    return [];
  }
}

/** The current highest outbox sequence (baseline for fresh connections). */
export async function currentOutboxSeq(): Promise<number | null> {
  try {
    await ensureTable();
    const rows = await withTimeout(
      db
        .select({ m: max(realtime_events.id) })
        .from(realtime_events),
      OUTBOX_TIMEOUT_MS,
      null,
    );
    const row = rows?.[0];
    return row?.m ? Number(row.m) : null;
  } catch {
    return null;
  }
}

/**
 * Opportunistic cleanup — keep only the newest `keep` rows so the outbox
 * never grows without bound. Fire-and-forget.
 */
export async function pruneOutbox(keep = 2000): Promise<void> {
  try {
    await ensureTable();
    await db.run(
      sql`DELETE FROM realtime_events WHERE id <= (SELECT MAX(id) - ${keep} FROM realtime_events)`,
    );
  } catch {
    // Pruning is best-effort.
  }
}
