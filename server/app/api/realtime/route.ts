/**
 * Unified Realtime WebSocket endpoint.
 *
 *   wss://meetsweet.space/api/realtime?token=<access-token>
 *
 * Served by Vercel Functions with Fluid compute (WebSockets require Fluid
 * compute; enabled project-wide in vercel.json). A connection is pinned to one
 * Function instance and is closed at the function max duration — the mobile
 * client reconnects with exponential backoff and recovers missed durable
 * events through the outbox (`sync`), which also covers reconnects onto a
 * different instance.
 *
 * AUTH: the access token arrives as a query parameter because React Native's
 * WebSocket cannot reliably send custom headers. It is verified here and the
 * live account state is re-checked from the DB (same policy as requireAuth).
 * The token is short-lived (15m) and the transport is wss; on 4401 the client
 * refreshes its token and reconnects.
 *
 * PROTOCOL (JSON):
 *   client → { type: 'subscribe', channels } | { type: 'unsubscribe', channels }
 *           | { type: 'ping' } | { type: 'sync', since }
 *           | { type: 'relay', channel, eventType, payload }  (ephemeral only)
 *   server → { type: 'hello', seq } | { type: 'subscribed', channels, denied }
 *           | { type: 'event', event } | { type: 'pong' } | { type: 'synced', since }
 *           | { type: 'error', code, message }
 *
 * SECURITY: every subscription is authorized server-side (user:{me} only for
 * the owner; chat:{room} only for room members; post:{id} for any
 * authenticated user). Clients can never publish durable events — only
 * allow-listed ephemeral types (typing/recording/presence) via `relay`, and
 * the acting userId is always set server-side.
 */

import { experimental_upgradeWebSocket, type WebSocketData } from "@vercel/functions";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { verifyToken } from "@/lib/auth/jwt";
import { fetchLiveAccount } from "@/middleware/auth";
import { getMember } from "@/lib/services/chat-rooms";
import {
  registerConnection,
  sendTo,
  subscribe,
  unsubscribe,
  channelsOf,
  touch,
} from "@/lib/realtime/hub";
import { currentOutboxSeq, readOutboxSince, pruneOutbox } from "@/lib/realtime/outbox";
import { broadcast } from "@/lib/realtime/hub";
import { registerBusConnection, unregisterBusConnection } from "@/lib/realtime/bus";
import { RELAYABLE_TYPES, type ClientMessage } from "@/lib/realtime/types";
import { randomUUID } from "crypto";

// Throttle relayed typing broadcasts per (user, channel) so keystroke-level
// frames can never storm the socket (spec: typing events especially must be
// throttled). Recording/presence relays are not throttled — they are discrete.
const TYPING_RELAY_THROTTLE_MS = 2_000;
const typingRelayLast = new Map<string, number>();

function typingRelayAllowed(userId: string, channel: string): boolean {
  const now = Date.now();
  const key = `${userId}:${channel}`;
  if ((typingRelayLast.get(key) ?? 0) + TYPING_RELAY_THROTTLE_MS > now) return false;
  typingRelayLast.set(key, now);
  return true;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Fluid compute: the connection lives until this duration, then Vercel closes
// it — the client reconnects (backoff) and recovers missed events via `sync`.
export const maxDuration = 300;

function splitChannel(channel: string): [string, string] {
  const idx = channel.indexOf(":");
  if (idx === -1) return ["", channel];
  return [channel.slice(0, idx), channel.slice(idx + 1)];
}

export function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";

  // Fail fast (before upgrade) when there is no token at all.
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  return experimental_upgradeWebSocket(async (ws) => {
    // Attach the message listener SYNCHRONOUSLY (before the async auth below)
    // and buffer frames until authentication completes — per the Vercel chat
    // guide, a client's first frame sent on open must never be dropped. The
    // client also waits for `hello` before subscribing, so this is belt and
    // suspenders.
    const pendingFrames: WebSocketData[] = [];
    let authenticated = false;
    let handleFrame: ((raw: WebSocketData) => void) | null = null;
    ws.on("message", (raw: WebSocketData) => {
      if (!authenticated || !handleFrame) {
        pendingFrames.push(raw);
        return;
      }
      handleFrame(raw);
    });

    // ── Authenticate the connection (verify JWT + live account) ───────────
    let user: { userId: string; role: string };
    try {
      const tokenUser = await verifyToken(token);
      const live = await fetchLiveAccount(tokenUser.userId);
      if (!live?.isActive || !live.role) throw new Error("Account inactive");
      user = { userId: tokenUser.userId, role: live.role };
    } catch {
      try {
        ws.close(4401, "Unauthorized");
      } catch {
        // ignore
      }
      return;
    }

    const conn = registerConnection(ws, user.userId);
    // This instance now holds a connection — start the cross-instance reader.
    registerBusConnection();
    ws.on("close", () => unregisterBusConnection());

    // Baseline sequence so the client can recover anything it missed while
    // disconnected (fresh connection: everything after this is new).
    const baseline = await currentOutboxSeq().catch(() => null);
    sendTo(conn, { type: "hello", seq: baseline });
    void pruneOutbox().catch(() => {});

    /** Server-side authorization for a channel subscription. */
    const authorizeChannel = async (channel: string): Promise<boolean> => {
      const [kind, id] = splitChannel(channel);
      if (!id) return false;
      if (kind === "user") return id === user.userId;
      if (kind === "chat") {
        const member = await getMember(id, user.userId).catch(() => null);
        return !!member;
      }
      if (kind === "post") {
        const [post] = await db
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.id, id))
          .limit(1)
          .catch(() => []);
        return !!post;
      }
      return false;
    };

    handleFrame = async (raw: WebSocketData) => {
      touch(conn);
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        sendTo(conn, { type: "error", code: "BAD_JSON", message: "Invalid JSON" });
        return;
      }

      switch (msg.type) {
        case "ping":
          sendTo(conn, { type: "pong" });
          return;

        case "subscribe": {
          const requested = Array.isArray(msg.channels)
            ? msg.channels.filter((c): c is string => typeof c === "string")
            : [];
          const granted: string[] = [];
          for (const channel of requested) {
            if (await authorizeChannel(channel)) {
              subscribe(conn, channel);
              granted.push(channel);
            }
          }
          const denied = requested.filter((c) => !granted.includes(c));
          sendTo(conn, { type: "subscribed", channels: granted, denied });
          return;
        }

        case "unsubscribe": {
          const requested = Array.isArray(msg.channels)
            ? msg.channels.filter((c): c is string => typeof c === "string")
            : [];
          for (const channel of requested) unsubscribe(conn, channel);
          sendTo(conn, { type: "unsubscribed", channels: requested });
          return;
        }

        case "sync": {
          const since = typeof msg.since === "number" && Number.isFinite(msg.since) ? msg.since : null;
          const channels = channelsOf(conn);
          if (since != null && channels.length > 0) {
            const events = await readOutboxSince(since, channels).catch(() => []);
            for (const event of events) {
              sendTo(conn, { type: "event", event });
            }
          }
          sendTo(conn, { type: "synced", since });
          return;
        }

        case "relay": {
          // Ephemeral presence relay — only allow-listed types, channel must
          // be authorized, and the acting userId is ALWAYS server-set. Durable
          // events can never originate from a client.
          if (typeof msg.channel !== "string" || typeof msg.eventType !== "string") {
            sendTo(conn, { type: "error", code: "BAD_RELAY", message: "Invalid relay" });
            return;
          }
          if (!RELAYABLE_TYPES.has(msg.eventType)) {
            sendTo(conn, {
              type: "error",
              code: "FORBIDDEN_RELAY",
              message: "Event type cannot be relayed by clients",
            });
            return;
          }
          if (!(await authorizeChannel(msg.channel))) {
            sendTo(conn, { type: "error", code: "FORBIDDEN", message: "Not subscribed" });
            return;
          }
          // Throttle typing.started (the client fires it on every debounce).
          if (msg.eventType === "chat.typing.started" && !typingRelayAllowed(user.userId, msg.channel)) {
            return;
          }
          broadcast(msg.channel, {
            id: randomUUID(),
            seq: null,
            type: msg.eventType,
            channel: msg.channel,
            ts: new Date().toISOString(),
            userId: user.userId,
            payload: msg.payload ?? {},
          });
          return;
        }

        default:
          sendTo(conn, { type: "error", code: "UNKNOWN_TYPE", message: "Unknown message type" });
      }
    };

    // Flush any frames that arrived while authentication was in flight.
    authenticated = true;
    for (const raw of pendingFrames) handleFrame(raw);
    pendingFrames.length = 0;

    ws.on("error", () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    });
  });
}
