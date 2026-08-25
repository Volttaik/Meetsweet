/**
 * Per-instance connection hub.
 *
 * A WebSocket connection is pinned to one Vercel Function instance (see
 * vercel.com/docs/functions/websockets). The hub fans events out to the
 * connections subscribed on THIS instance. Cross-instance delivery is not
 * attempted in memory — the durable outbox (`outbox.ts`) guarantees no event
 * is lost: a client whose reconnect lands on another instance replays missed
 * events via `sync`.
 */

import type { RealtimeEvent } from "./types";

export interface Connection {
  id: string;
  userId: string;
  send: (data: string) => void;
  close: (code?: number) => void;
  channels: Set<string>;
  lastSeen: number;
}

/** connectionId → connection */
const connections = new Map<string, Connection>();
/** channel → connectionIds */
const channelSubscribers = new Map<string, Set<string>>();

export function addConnection(conn: Connection): void {
  connections.set(conn.id, conn);
}

export function removeConnection(connectionId: string): void {
  const conn = connections.get(connectionId);
  if (!conn) return;
  for (const channel of conn.channels) {
    channelSubscribers.get(channel)?.delete(connectionId);
    if (channelSubscribers.get(channel)?.size === 0) channelSubscribers.delete(channel);
  }
  connections.delete(connectionId);
}

export function subscribe(connectionId: string, channels: string[]): void {
  const conn = connections.get(connectionId);
  if (!conn) return;
  for (const channel of channels) {
    conn.channels.add(channel);
    let set = channelSubscribers.get(channel);
    if (!set) {
      set = new Set();
      channelSubscribers.set(channel, set);
    }
    set.add(connectionId);
  }
}

export function unsubscribe(connectionId: string, channels: string[]): void {
  const conn = connections.get(connectionId);
  if (!conn) return;
  for (const channel of channels) {
    conn.channels.delete(channel);
    channelSubscribers.get(channel)?.delete(connectionId);
  }
}

/**
 * Fan an event out to every connection subscribed to its channel on this
 * instance. Fire-and-forget; never throws.
 */
export function fanOut(event: RealtimeEvent): void {
  const ids = channelSubscribers.get(event.channel);
  if (!ids || ids.size === 0) return;
  const frame = JSON.stringify({ type: "event", event });
  for (const id of ids) {
    try {
      connections.get(id)?.send(frame);
    } catch {
      // Dead socket — its close handler will clean it up.
    }
  }
}

export function getConnection(connectionId: string): Connection | undefined {
  return connections.get(connectionId);
}

/** Drop connections idle beyond `maxIdleMs` (dead sockets without a close event). */
export function pruneIdle(maxIdleMs: number): void {
  const cutoff = Date.now() - maxIdleMs;
  for (const [id, conn] of connections) {
    if (conn.lastSeen < cutoff) removeConnection(id);
  }
}
