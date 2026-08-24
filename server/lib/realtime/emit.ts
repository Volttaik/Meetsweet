/**
 * emitEvent — the single entry point for publishing realtime events.
 *
 * Call this AFTER the authoritative database write (the DB is the source of
 * truth; the event is a notification that something changed). It:
 *   1. assigns the event id + timestamp,
 *   2. appends DURABLE events to the Turso outbox (cross-instance recovery),
 *   3. fans out to every connection on THIS instance subscribed to the channel.
 *
 * Fire-and-forget: realtime emission must never break or delay the API
 * response, so failures are swallowed.
 */

import { randomUUID } from "crypto";
import { broadcast } from "./hub";
import { publishEvent } from "./bus";
import { appendOutboxEvent } from "./outbox";
import type { EmitOptions, RealtimeEvent } from "./types";
import { canonicalEventType } from "./sweet-socket/event-emitter";

export async function emitEvent(opts: EmitOptions): Promise<void> {
  try {
    const ts = new Date().toISOString();
    const event: RealtimeEvent = {
      id: randomUUID(),
      seq: null,
      type: canonicalEventType(opts.type),
      channel: opts.channel,
      ts,
      resourceId: opts.resourceId,
      userId: opts.userId,
      payload: opts.payload ?? {},
    };

    // Durable events are appended before fanout. A client may disconnect
    // immediately after receiving a live frame; replay must already contain
    // that exact event, otherwise the disconnect window can lose it.
    if (opts.durable !== false) {
      event.seq = await appendOutboxEvent(event);
    }
    broadcast(opts.channel, event);
    // Redis is shared coordination for instances pinned to different
    // WebSocket Function instances; it is intentionally best-effort.
    await publishEvent(event);
  } catch {
    // Realtime emission is best-effort — never break the API response.
  }
}
