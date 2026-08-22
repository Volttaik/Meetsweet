import { experimental_upgradeWebSocket, type WebSocketData } from "@vercel/functions";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth/jwt";
import { fetchLiveAccount } from "@/middleware/auth";
import { currentOutboxSeq, readOutboxSince, pruneOutbox } from "@/lib/realtime/outbox";
import { registerBusConnection, unregisterBusConnection } from "@/lib/realtime/bus";
import * as manager from "@/lib/realtime/sweet-socket/connection-manager";
import { connected, disconnected } from "@/lib/realtime/sweet-socket/presence-manager";
import { createEvent } from "@/lib/realtime/sweet-socket/event-emitter";
import { handleClientMessage, authorizeChannel } from "@/lib/realtime/sweet-socket/router";
import { parseFrame } from "@/lib/realtime/sweet-socket/validator";
import type { SweetSocketClientMessage } from "@/lib/realtime/sweet-socket/types";

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
    let connection: ReturnType<typeof manager.register> | null = null;
    let frameHandler: ((raw: WebSocketData) => void) | null = null;
    let processing = Promise.resolve();

    ws.on("message", (raw: WebSocketData) => {
      if (!authenticated || !frameHandler) pending.push(raw);
      else frameHandler(raw);
    });

    void (async () => {
      try {
        const tokenUser = await verifyToken(token);
        const live = await fetchLiveAccount(tokenUser.userId);
        if (!live?.isActive || !live.role) throw new Error("Account inactive");

        connection = manager.register(ws, tokenUser.userId);
        registerBusConnection();
        manager.send(connection, { type: "auth", state: "connected" });
        ws.on("close", () => {
          unregisterBusConnection();
          if (connection && disconnected(connection)) {
            const event = createEvent({
              type: "presence.offline",
              userId: connection.userId,
              payload: { userId: connection.userId },
            });
            // Presence is ephemeral and only useful to current subscribers.
            for (const channel of connection.channels) manager.broadcast(channel, event);
          }
        });

        const sequence = await currentOutboxSeq().catch(() => null);
        manager.send(connection, { type: "auth", state: "authenticated" });
        manager.send(connection, { type: "connection", state: "authenticated" });
        manager.send(connection, { type: "hello", sequence });
        manager.send(connection, { type: "connection", state: "ready" });
        if (connected(connection)) {
          const event = createEvent({
            type: "presence.online",
            userId: connection.userId,
            payload: { userId: connection.userId },
          });
          for (const channel of connection.channels) manager.broadcast(channel, event);
        }
        void pruneOutbox().catch(() => {});

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
        // sends subscribe followed by sync; replay must see the restored room
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
          manager.subscribe(connection, channel);
          granted.push(channel);
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
      for (const channel of message.channels) manager.unsubscribe(connection, channel);
      manager.send(connection, { type: "unsubscribed", channels: message.channels });
      return;
    case "sync": {
      const since = message.since;
      if (since !== null) {
        const events = await readOutboxSince(since, manager.channelsOf(connection)).catch(() => []);
        for (const event of events) manager.send(connection, { type: "event", event: toSweetEvent(event) });
      }
      manager.send(connection, { type: "synced", since });
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
}) {
  return {
    id: event.id,
    version: 1 as const,
    type: event.type,
    timestamp: new Date(event.ts).getTime(),
    userId: event.userId ?? "",
    channel: event.channel,
    roomId: event.channel.replace(/^(chat|conversation|post):/, "") || undefined,
    resourceId: event.resourceId,
    clientMessageId: typeof event.payload.clientMessageId === "string" ? event.payload.clientMessageId : undefined,
    sequence: event.seq,
    payload: event.payload,
  };
}
