import { appendOutboxEvent } from "../outbox";
import { publishEvent } from "../bus";
import { createEvent } from "./event-emitter";
import type { SweetSocketEvent } from "./types";

/**
 * SweetSocket's live path is deliberately independent from Turso latency:
 * callers receive the event first, while the durable outbox and Redis relay
 * are attempted in the background. Events that cannot be appended still carry
 * their UUID, so a later domain reconciliation can identify them.
 */
export function publish(input: {
  type: string;
  userId: string;
  channel?: string;
  roomId?: string;
  resourceId?: string;
  clientMessageId?: string;
  payload?: Record<string, unknown>;
  durable?: boolean;
}): SweetSocketEvent {
  const event = createEvent(input);
  if (input.durable !== false) void persistEvent(event);
  return event;
}

export async function persistEvent(event: SweetSocketEvent): Promise<void> {
  const legacyEvent = {
    id: event.id,
    seq: null,
    type: event.type,
    channel: event.channel ?? "",
    ts: new Date(event.timestamp).toISOString(),
    resourceId: event.resourceId,
    userId: event.userId,
    payload: {
      ...event.payload,
      clientMessageId: event.clientMessageId,
      roomId: event.roomId,
      version: event.version,
    },
  };
  const sequence = await appendOutboxEvent(legacyEvent);
  event.sequence = sequence;
  if (event.channel) void publishEvent({ ...legacyEvent, seq: sequence });
}
