import type { SweetSocketClientMessage } from "./types";

const MAX_FRAME_BYTES = 64 * 1024;
const MAX_CHANNELS_PER_REQUEST = 100;
const MAX_COMMAND = 64;
const COMMAND_NAME = /^[a-z][a-z0-9._-]{1,63}$/;

export function parseFrame(raw: unknown): SweetSocketClientMessage | null {
  const text = typeof raw === "string" ? raw : String(raw);
  if (Buffer.byteLength(text, "utf8") > MAX_FRAME_BYTES) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (!value || typeof value.type !== "string") return null;
    if (value.type === "subscribe" || value.type === "unsubscribe") {
      if (!Array.isArray(value.channels) || value.channels.length > MAX_CHANNELS_PER_REQUEST) return null;
      const channels = value.channels.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 160);
      if (channels.length !== value.channels.length) return null;
      return { type: value.type, channels };
    }
    if (value.type === "ping") return { type: "ping" };
    if (value.type === "sync") {
      return { type: "sync", since: typeof value.since === "number" && Number.isFinite(value.since) ? value.since : null };
    }
    if (value.type === "relay") {
      if (typeof value.channel !== "string" || typeof value.eventType !== "string") return null;
      if (value.channel.length > 160 || value.eventType.length > MAX_COMMAND) return null;
      return {
        type: "relay",
        channel: value.channel,
        eventType: value.eventType,
        payload: isRecord(value.payload) ? value.payload : {},
      };
    }
    if (value.type === "command") {
      if (typeof value.requestId !== "string" || value.requestId.length < 1 || value.requestId.length > 100) return null;
      if (typeof value.command !== "string" || !COMMAND_NAME.test(value.command)) return null;
      if (value.channel !== undefined && (typeof value.channel !== "string" || value.channel.length > 160)) return null;
      if (value.clientMessageId !== undefined && (typeof value.clientMessageId !== "string" || value.clientMessageId.length > 160)) return null;
      return {
        type: "command",
        requestId: value.requestId,
        command: value.command,
        channel: value.channel as string | undefined,
        clientMessageId: value.clientMessageId as string | undefined,
        payload: isRecord(value.payload) ? value.payload : {},
      };
    }
  } catch {
    return null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validRelayType(eventType: string): boolean {
  // Accept the canonical colon names the mobile client sends (typing:start,
  // voice:start, presence:updated, chat:open, chat:close) AND the legacy
  // dotted aliases so older clients keep working during rollout. Everything
  // else is rejected — relays are for EPHEMERAL client-announced state only;
  // durable mutations go through commands or HTTP.
  return [
    "typing:start",
    "typing:stop",
    "voice:start",
    "voice:stop",
    "presence:online",
    "presence:offline",
    "presence:updated",
    "chat:open",
    "chat:close",
    "typing.start",
    "typing.stop",
    "recording.start",
    "recording.stop",
    "presence.online",
    "presence.offline",
    "chat.typing.started",
    "chat.typing.stopped",
    "chat.recording.started",
    "chat.recording.stopped",
    "chat.presence.updated",
  ].includes(eventType);
}
