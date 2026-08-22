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

export async function emitEvent(opts: EmitOptions): Promise<void> {
  try {
    const ts = new Date().toISOString();
    const event: RealtimeEvent = {
      id: randomUUID(),
      seq: null,
      type: opts.type,
      channel: opts.channel,
      ts,
      resourceId: opts.resourceId,
      userId: opts.userId,
      payload: opts.payload ?? {},
    };

    // Durable events go to the outbox first (source for missed-event recovery
    // and cross-instance delivery). Ephemeral events are broadcast only.
    if (opts.durable !== false) {
      event.seq = await appendOutboxEvent(event);
    }

    // 1. Local fan-out first (instant within this instance).
    broadcast(opts.channel, event);
    // 2. Then publish to the shared Redis stream so OTHER instances (their
    //    blocking readers wake immediately) deliver it to their subscribers.
    //    No-op when REDIS_URL is not configured — single-instance fallback.
    void publishEvent(event);
  } catch {
    // Realtime emission is best-effort — never break the API response.
  }
}
