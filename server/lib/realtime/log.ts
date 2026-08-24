/**
 * Minimal structured logger for the realtime layer.
 *
 * Every line is a single `key=value` record prefixed with `[realtime]` so it is
 * trivially greppable in Vercel's log viewer by userId / clientMessageId /
 * roomId / requestId when chasing an intermittent delivery failure.
 *
 * Deliberate scope: only IDENTIFIERS and lifecycle state are logged — never
 * message bodies, media URLs, tokens, or anything that could be sensitive.
 * A message send is traceable end-to-end through these transitions:
 *
 *   connect / disconnect
 *   command (received) → message.accepted → message.persisted | message.failed
 *
 * Anything that throws is logged with the error name + message so the next
 * intermittent failure is diagnosable without logging payload contents.
 */

const PREFIX = "[realtime]";

function emit(fields: Record<string, unknown>): void {
  const line = Object.entries(fields)
    .map(([key, value]) => `${key}=${format(value)}`)
    .join(" ");
  // eslint-disable-next-line no-console
  console.log(`${PREFIX} ${line}`);
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.includes(" ") ? JSON.stringify(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** An event occurred on a socket connection (connect / disconnect / auth). */
export function logConnection(event: "connect" | "disconnect", fields: { userId: string; connectionId?: string; channels?: number; reason?: string }): void {
  emit({ event, ...fields });
}

/** A command frame arrived on the wire, before any processing. */
export function logCommand(fields: {
  userId: string;
  connectionId?: string;
  command: string;
  requestId?: string;
  clientMessageId?: string;
  roomId?: string;
}): void {
  emit({ event: "command", ...fields });
}

/** The message was accepted (provisional event broadcast). */
export function logMessageAccepted(fields: { userId: string; clientMessageId: string; roomId: string }): void {
  emit({ event: "message.accepted", ...fields });
}

/** The message was durably persisted and the terminal ack was sent. */
export function logMessagePersisted(fields: { userId: string; clientMessageId: string; roomId: string; messageId?: string }): void {
  emit({ event: "message.persisted", ...fields });
}

/** The message failed with a meaningful error and the terminal ack was sent. */
export function logMessageFailed(fields: { userId: string; clientMessageId: string; roomId: string; error: string }): void {
  emit({ event: "message.failed", ...fields });
}

/** A reconnect sync replay page was served. */
export function logSync(fields: { userId: string; clientId?: string; since: number; through: number; hasMore: boolean }): void {
  emit({ event: "sync", ...fields });
}

/** A command exceeded the server-side processing bound and was abandoned. */
export function logCommandTimeout(fields: { userId: string; command: string; requestId?: string; clientMessageId?: string }): void {
  emit({ event: "command.timeout", ...fields });
}

/** Any other realtime-layer failure (error name + message only). */
export function logRealtimeError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "UnknownError";
  emit({ event: "error", context, name, message });
}
