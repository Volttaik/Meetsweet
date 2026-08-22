/**
 * Realtime Hub — the per-Function-instance connection registry.
 *
 * Vercel pins each WebSocket connection to ONE Function instance (Fluid
 * compute). This module tracks the connections currently hosted on THIS
 * instance and their channel subscriptions, and fans events out to them.
 *
 * CROSS-INSTANCE DELIVERY: an event emitted on instance A only reaches
 * connections hosted on A via this hub. To reach connections on other
 * instances, every DURABLE event is also appended to the Turso outbox
 * (lib/realtime/outbox.ts); when a client reconnects — possibly onto a
 * different instance — it replays missed events from the outbox by sequence.
 * Ephemeral events (typing/recording/presence) are intentionally NOT durable;
 * they only reach connections co-located on the emitting instance. For
 * multi-instance ephemeral fan-out, plug a Redis pub/sub into `emitEvent`
 * (documented in .agent/REALTIME.md).
 */

import type { WebSocket } from "ws";
import type { RealtimeEvent } from "./types";

const OPEN = 1; // ws.readyState === WebSocket.OPEN

export interface Connection {
  ws: WebSocket;
  userId: string;
  channels: Set<string>;
  lastSeen: number;
}

const connections = new Set<Connection>();

/** Register a new authenticated connection and auto-remove it on close. */
export function registerConnection(ws: WebSocket, userId: string): Connection {
  const conn: Connection = { ws, userId, channels: new Set(), lastSeen: Date.now() };
  connections.add(conn);
  ws.on("close", () => connections.delete(conn));
  return conn;
}

export function sendTo(conn: Connection, message: object): void {
  try {
    if (conn.ws.readyState === OPEN) conn.ws.send(JSON.stringify(message));
  } catch {
    // Socket may be mid-close — ignore.
  }
}

/** Fan an event out to every connection on THIS instance subscribed to the channel. */
export function broadcast(channel: string, event: RealtimeEvent): void {
  const payload = JSON.stringify({ type: "event", event });
  for (const conn of connections) {
    if (conn.channels.has(channel)) {
      try {
        if (conn.ws.readyState === OPEN) conn.ws.send(payload);
      } catch {
        // Ignore individual socket failures — never break the event loop.
      }
    }
  }
}

export function subscribe(conn: Connection, channel: string): void {
  conn.channels.add(channel);
}

export function unsubscribe(conn: Connection, channel: string): void {
  conn.channels.delete(channel);
}

export function channelsOf(conn: Connection): string[] {
  return [...conn.channels];
}

export function touch(conn: Connection): void {
  conn.lastSeen = Date.now();
}

export function connectionCount(): number {
  return connections.size;
}
