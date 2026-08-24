import { experimental_upgradeWebSocket, type WebSocketData } from "@vercel/functions";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth/jwt";
import { fetchLiveAccount } from "@/middleware/auth";
import { currentOutboxSeq, readOutboxSince } from "@/lib/realtime/outbox";
import { acknowledgeCursor, readCursor } from "@/lib/realtime/cursors";
import { registerBusConnection, unregisterBusConnection } from "@/lib/realtime/bus";
import * as manager from "@/lib/realtime/sweet-socket/connection-manager";
import { connected, disconnected } from "@/lib/realtime/sweet-socket/presence-manager";
import { createEvent } from "@/lib/realtime/sweet-socket/event-emitter";
import { SWEETSOCKET_EVENT } from "@/lib/realtime/sweet-socket/event-map";
import { handleClientMessage, authorizeChannel } from "@/lib/realtime/sweet-socket/router";
import { parseFrame } from "@/lib/realtime/sweet-socket/validator";
import type { SweetSocketClientMessage, SweetSocketConnection } from "@/lib/realtime/sweet-socket/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) return new Response("Unauthorized", { status: 401 });

  return experimental_upgradeWebSocket((ws) => {
    // Register the listener synchronously. Vercel's upgrade can deliver the
    // first client frame immediately, so authentication frames are buffered
    // until the async JWT/account check finishes.
    const pending: WebSocketData[] = [];
    let authenticated = false;
    let connection: SweetSocketConnection | null = null;
    let frameHandler: ((raw: WebSocketData) => void) | null = null;
    let processing = Promise.resolve();
    let cleanedUp = false;
    let presenceRegistered = false;
    let busRegistered = false;

    ws.on("message", (raw: WebSocketData) => {
      if (!authenticated || !frameHandler) pending.push(raw);
      else frameHandler(raw);
    });

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (connection) {
        const channels = [...connection.channels];
        manager.unregister(connection);
        for (const channel of channels) {
          if (channel.startsWith("chat:") && !manager.isUserSubscribedTo(connection.userId, channel)) {
            broadcastPresence(channel, connection, SWEETSOCKET_EVENT.presenceUpdated, false);
          }
        }
        if (presenceRegistered && disconnected(connection)) {
          // Global presence is also exposed on the user's private channel for
          // clients that are not currently viewing a room.
          broadcastPresence(`user:${connection.userId}`, connection, SWEETSOCKET_EVENT.presenceOffline, false);
        }
      }
      if (busRegistered) {
        busRegistered = false;
        unregisterBusConnection();
      }
    };

    ws.on("close", cleanup);
    ws.on("error", cleanup);

    void (async () => {
      try {
        const tokenUser = await verifyToken(token);
        const live = await fetchLiveAccount(tokenUser.userId);
        if (!live?.isActive || !live.role) throw new Error("Account inactive");

        connection = manager.register(ws, tokenUser.userId);
        // Every authenticated socket owns its private user channel. Chat screens
        // may add room channels, but offline delivery and app-wide events must
        // never depend on a room being open.
        manager.subscribe(connection, `user:${tokenUser.userId}`);
        if (cleanedUp) {
          manager.unregister(connection);
          return;
        }
        registerBusConnection();
        busRegistered = true;
        manager.send(connection, { type: "auth", state: "connected" });
        manager.send(connection, { type: "connection", state: "connected" });

        const sequence = await currentOutboxSeq().catch(() => null);
        if (cleanedUp) return;
        // The server head is informational only. Replay starts from the
        // authenticated client's durable cursor, never from the current head.
        // This is what makes a first connection after an offline send converge.
        presenceRegistered = connected(connection);
        manager.send(connection, { type: "auth", state: "authenticated" });
        manager.send(connection, { type: "connection", state: "authenticated" });
        manager.send(connection, { type: "hello", sequence });
        manager.send(connection, { type: "connection", state: "ready" });

        const process = async (raw: WebSocketData) => {
          manager.touch(connection!);
          const message = parseFrame(raw);
          if (!message) {
            manager.send(connection!, { type: "error", code: "INVALID_FRAME", message: "Invalid or oversized frame" });
            return;
          }
          await processMessage(connection!, message);
        };
        // Preserve client command order. In particular, a reconnecting client
        // sends subscribe followed by sync; replay must see restored room
        // membership before events are delivered.
        frameHandler = (raw) => {
          processing = processing.then(() => process(raw)).catch(() => {});
        };
        authenticated = true;
        for (const raw of pending) frameHandler(raw);
        pending.length = 0;
      } catch {
        try {
          if (connection) manager.send(connection, { type: "auth", state: "session_expired", reason: "Session is no longer valid" });
          ws.close(4401, "Unauthorized");
        } catch { /* ignore */ }
      }
    })();
  });
}

function broadcastPresence(
  channel: string,
  connection: SweetSocketConnection,
  type: string,
  online: boolean,
): void {
  const event = createEvent({
    type,
    userId: connection.userId,
    channel,
    roomId: channel.startsWith("chat:") ? channel.slice("chat:".length) : undefined,
    payload: { userId: connection.userId, online },
  });
  manager.broadcast(channel, event);
}

async function processMessage(
  connection: NonNullable<ReturnType<typeof manager.register>>,
  message: SweetSocketClientMessage,
): Promise<void> {
  switch (message.type) {
    case "ping": {
      // Re-check the live account on heartbeat. JWT validation at upgrade time
      // is not enough when a session is revoked or an account is deactivated
      // while the socket remains open.
      if (Date.now() - connection.lastAuthCheck >= 60_000) {
        const live = await fetchLiveAccount(connection.userId);
        connection.lastAuthCheck = Date.now();
        if (!live?.isActive || !live.role) {
          manager.send(connection, { type: "auth", state: "session_expired", reason: "Account is no longer active" });
          for (const channel of manager.channelsOf(connection)) manager.unsubscribe(connection, channel);
          try { connection.ws.close(4401, "Session expired"); } catch { /* ignore */ }
          return;
        }
      }
      manager.send(connection, { type: "pong" });
      return;
    }
    case "subscribe": {
      const granted: string[] = [];
      for (const channel of message.channels) {
        if (await authorizeChannel(channel, connection.userId)) {
          const wasSubscribed = manager.isUserSubscribedTo(connection.userId, channel);
          manager.subscribe(connection, channel);
          granted.push(channel);
          if (channel.startsWith("chat:") && !wasSubscribed) {
            broadcastPresence(channel, connection, SWEETSOCKET_EVENT.presenceUpdated, true);
          }
        }
      }
      manager.send(connection, {
        type: "subscribed",
        channels: granted,
        denied: message.channels.filter((channel) => !granted.includes(channel)),
      });
      return;
    }
    case "unsubscribe":
      for (const channel of message.channels) {
        const wasSubscribed = manager.isUserSubscribedTo(connection.userId, channel);
        manager.unsubscribe(connection, channel);
        if (channel.startsWith("chat:") && wasSubscribed && !manager.isUserSubscribedTo(connection.userId, channel)) {
          broadcastPresence(channel, connection, SWEETSOCKET_EVENT.presenceUpdated, false);
        }
      }
      manager.send(connection, { type: "unsubscribed", channels: message.channels });
      return;
    case "sync": {
      const requestedClientId = typeof message.clientId === "string" ? message.clientId.trim().slice(0, 160) : "";
      if (!requestedClientId) {
        manager.send(connection, { type: "error", code: "INVALID_SYNC", message: "clientId is required" });
        return;
      }
      connection.syncClientId = requestedClientId;
      const stored = await readCursor(connection.userId, requestedClientId).catch(() => 0);
      // The durable ACK is the lower bound on a fresh connection. During a
      // multi-page replay, the in-memory cursor advances page by page without
      // being ACKed until the final page is applied; this prevents page one
      // from being replayed forever while still replaying it after a crash.
      const since = Math.max(stored, connection.syncCursor ?? stored);
      const channels = manager.channelsOf(connection);
      let through = since;
      let hasMore = false;
      const events = await readOutboxSince(since, channels, 200).catch(() => []);
      for (const event of events) {
        through = Math.max(through, event.seq ?? through);
        manager.send(connection, { type: "event", event: toSweetEvent(event) });
      }
      if (events.length === 200) hasMore = true;
      connection.syncCursor = through;
      connection.acknowledgedSequence = Math.max(connection.acknowledgedSequence ?? 0, stored);
      manager.send(connection, { type: "synced", since, through, hasMore });
      return;
    }
    case "ack": {
      if (!connection.syncClientId || connection.syncClientId !== message.clientId || !Number.isFinite(message.sequence)) {
        manager.send(connection, { type: "error", code: "INVALID_ACK", message: "Invalid sync acknowledgement" });
        return;
      }
      const sequence = await acknowledgeCursor(connection.userId, connection.syncClientId, message.sequence).catch(() => connection.acknowledgedSequence ?? 0);
      connection.acknowledgedSequence = Math.max(connection.acknowledgedSequence ?? 0, sequence);
      manager.send(connection, { type: "sync_ack", clientId: connection.syncClientId, sequence: connection.acknowledgedSequence });
      return;
    }
    case "command":
    case "relay":
      await handleClientMessage(connection, message);
      return;
  }
}

function toSweetEvent(event: {
  id: string;
  seq: number | null;
  type: string;
  channel: string;
  ts: string;
  resourceId?: string;
  userId?: string;
  payload: Record<string, unknown>;
  roomId?: string;
}) {
  return {
    id: event.id,
    version: 1 as const,
    type: event.type,
    timestamp: new Date(event.ts).getTime(),
    userId: event.userId ?? "",
    channel: event.channel,
    roomId: event.roomId ?? (event.channel.replace(/^(chat|conversation|post):/, "") || undefined),
    resourceId: event.resourceId,
    clientMessageId: typeof event.payload.clientMessageId === "string" ? event.payload.clientMessageId : undefined,
    sequence: event.seq,
    payload: event.payload,
  };
}
