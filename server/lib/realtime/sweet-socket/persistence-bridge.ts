import { appendOutboxEvent } from "../outbox";
import { publishEvent } from "../bus";
import { createEvent } from "./event-emitter";
import type { SweetSocketEvent } from "./types";

/**
 * Publish an event for the live transport. Ephemeral events are sent directly;
 * durable events should use publishDurable when the caller must guarantee that
 * replay storage exists before the live frame is delivered.
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

/** Create and persist a durable event before returning it for live fanout. */
export async function publishDurable(input: {
  type: string;
  userId: string;
  channel?: string;
  roomId?: string;
  resourceId?: string;
  clientMessageId?: string;
  payload?: Record<string, unknown>;
}): Promise<SweetSocketEvent> {
  const event = createEvent(input);
  await persistEvent(event);
  return event;
}

/** Publish one durable event per authenticated recipient. A private user
 * channel is the primary delivery path for events that must survive a room
 * being closed or a recipient being offline. */
export async function publishForUsers(input: {
  type: string;
  userIds: string[];
  roomId?: string;
  resourceId?: string;
  clientMessageId?: string;
  payload?: Record<string, unknown>;
}): Promise<SweetSocketEvent[]> {
  const events = [...new Set(input.userIds)].map((userId) => createEvent({
    type: input.type,
    userId,
    channel: `user:${userId}`,
    roomId: input.roomId,
    resourceId: input.resourceId,
    clientMessageId: input.clientMessageId,
    payload: { ...(input.payload ?? {}), roomId: input.roomId },
  }));
  // Persist before fanout. A recipient can disconnect immediately after the
  // live frame; replay must already have a durable row for that frame.
  await Promise.all(events.map((event) => persistEvent(event)));
  return events;
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
