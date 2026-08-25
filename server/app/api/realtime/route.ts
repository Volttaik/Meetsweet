/**
 * GET /api/realtime — the application WebSocket endpoint.
 *
 * Built on Vercel's documented Functions WebSocket support:
 *  - Requires Fluid compute (enabled project-wide in vercel.json).
 *  - A connection is pinned to ONE Function instance and is closed when the
 *    function reaches max duration — clients MUST reconnect (the mobile
 *    singleton does, with backoff) and resync missed durable events.
 *  - Durable state lives in Turso (`realtime_events`), never in function
 *    memory. `sync { since }` replays what a reconnecting client missed even
 *    when it lands on a different instance.
 *
 * Frames (see lib/realtime/types.ts):
 *   client → server: subscribe | unsubscribe | ping | sync
 *   server → client: hello | subscribed | event | pong | synced | error
 *
 * Clients can never publish events. There are no typing/presence/read-receipt
 * relays — Private Inbox is correspondence, not chat.
 */

import type { NextRequest } from "next/server";
import { experimental_upgradeWebSocket, type WebSocketData } from "@vercel/functions";
import { verifyToken } from "@/lib/auth/jwt";
import { fetchLiveAccount } from "@/middleware/auth";
import {
  addConnection,
  removeConnection,
  subscribe,
  unsubscribe,
  getConnection,
  pruneIdle,
} from "@/lib/realtime/hub";
import { eventsForUserSince, currentSeq } from "@/lib/realtime/outbox";
import { parseChannel, type ClientFrame } from "@/lib/realtime/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Connections close at max duration; the client reconnects and resyncs.
export const maxDuration = 300;

let connectionCounter = 0;

function textOf(data: WebSocketData): string | null {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return null;
}

// Idle sweeper — one per instance, started lazily. Dead sockets that never
// sent a close frame would otherwise leak hub entries.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
let sweeperStarted = false;
function ensureSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  const timer = setInterval(() => {
    pruneIdle(IDLE_TIMEOUT_MS);
  }, 60_000);
  // Never keep the process alive just for the sweeper.
  timer.unref?.();
}

export async function GET(req: NextRequest) {
  // ── Authenticate BEFORE upgrading ────────────────────────────────────────
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("authorization")?.slice(7);
  let userId: string | null = null;
  if (token) {
    try {
      const payload = await verifyToken(token);
      const live = await fetchLiveAccount(payload.userId);
      if (live?.isActive && live.role) userId = payload.userId;
    } catch {
      userId = null;
    }
  }
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const ownerUserId = userId;

  return experimental_upgradeWebSocket((ws) => {
    const connectionId = `conn_${++connectionCounter}_${Date.now().toString(36)}`;

    ws.on("open", () => {
      void currentSeq().then((head) => {
        try {
          ws.send(JSON.stringify({ type: "hello", seq: head }));
        } catch {}
      });
      addConnection({
        id: connectionId,
        userId: ownerUserId,
        channels: new Set<string>(),
        lastSeen: Date.now(),
        send: (data) => ws.send(data),
        close: () => ws.close(),
      });
      ensureSweeper();
    });

    ws.on("message", (data: WebSocketData) => {
      const raw = textOf(data);
      if (!raw) return;
      const conn = getConnection(connectionId);
      if (!conn) return;
      conn.lastSeen = Date.now();

      let frame: ClientFrame;
      try {
        frame = JSON.parse(raw) as ClientFrame;
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "bad_frame" }));
        return;
      }

      switch (frame.type) {
        case "subscribe": {
          const allowed: string[] = [];
          const denied: string[] = [];
          for (const channel of frame.channels ?? []) {
            const parsed = parseChannel(channel);
            // Server-side authorization: you may only subscribe to your own stream.
            if (parsed && parsed.userId === ownerUserId) allowed.push(channel);
            else denied.push(channel);
          }
          subscribe(connectionId, allowed);
          ws.send(JSON.stringify({ type: "subscribed", channels: allowed, denied }));
          break;
        }
        case "unsubscribe": {
          unsubscribe(connectionId, frame.channels ?? []);
          break;
        }
        case "ping": {
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        }
        case "sync": {
          // Replay MY durable events newer than the client's last seen seq.
          // The channel check is implicit: we only ever replay events whose
          // owner is the authenticated user.
          void eventsForUserSince(ownerUserId, Number(frame.since) || 0)
            .then((events) => {
              try {
                for (const event of events) {
                  ws.send(JSON.stringify({ type: "event", event }));
                }
              } catch {
                // Socket died mid-replay — the next reconnect re-syncs.
              }
              ws.send(
                JSON.stringify({
                  type: "synced",
                  since: Number(frame.since) || 0,
                  count: events.length,
                }),
              );
            })
            .catch(() => {
              ws.send(JSON.stringify({ type: "error", code: "sync_failed" }));
            });
          break;
        }
        default:
          ws.send(JSON.stringify({ type: "error", code: "unknown_frame" }));
      }
    });

    ws.on("close", () => {
      removeConnection(connectionId);
    });

    ws.on("error", () => {
      removeConnection(connectionId);
    });
  });
}

