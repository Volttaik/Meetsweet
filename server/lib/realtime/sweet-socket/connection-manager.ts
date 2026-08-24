import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import { clearUserRoomFocus } from "@/lib/services/room-focus";
import type { SweetSocketConnection } from "./types";

const OPEN = 1;
const connections = new Map<string, SweetSocketConnection>();
const userConnections = new Map<string, Set<string>>();

export function register(ws: WebSocket, userId: string): SweetSocketConnection {
  const connection: SweetSocketConnection = {
    id: randomUUID(),
    ws,
    userId,
    channels: new Set(),
    lastSeen: Date.now(),
    authenticatedAt: Date.now(),
    lastAuthCheck: Date.now(),
  };
  connections.set(connection.id, connection);
  const ids = userConnections.get(userId) ?? new Set<string>();
  ids.add(connection.id);
  userConnections.set(userId, ids);
  ws.on("close", () => unregister(connection));
  ws.on("error", () => unregister(connection));
  return connection;
}

export function unregister(connection: SweetSocketConnection): void {
  if (!connections.delete(connection.id)) return;
  const ids = userConnections.get(connection.userId);
  ids?.delete(connection.id);
  if (ids?.size === 0) {
    userConnections.delete(connection.userId);
    // The user's last connection is gone — drop their room-focus entries so a
    // stale "viewing" flag can never permanently suppress their pushes.
    clearUserRoomFocus(connection.userId);
  }
}

export function touch(connection: SweetSocketConnection): void {
  connection.lastSeen = Date.now();
}

export function connectionsForUser(userId: string): SweetSocketConnection[] {
  return [...(userConnections.get(userId) ?? [])]
    .map((id) => connections.get(id))
    .filter((connection): connection is SweetSocketConnection => Boolean(connection));
}

/**
 * Whether the user currently has at least one live connection subscribed to
 * `channel` — i.e. the user is actively receiving events on that room. Used to
 * auto-emit delivery receipts (Baileys-style) so the sender learns the
 * recipient actually received the message, without an HTTP round-trip.
 */
export function isUserSubscribedTo(userId: string, channel: string): boolean {
  return connectionsForUser(userId).some((connection) => connection.channels.has(channel));
}

export function disconnectUser(userId: string, code = 4401, reason = "Session expired"): void {
  for (const connection of connectionsForUser(userId)) {
    try { connection.ws.close(code, reason); } catch { /* close handler cleans it up */ }
  }
}

export function subscribe(connection: SweetSocketConnection, channel: string): void {
  connection.channels.add(channel);
}

export function unsubscribe(connection: SweetSocketConnection, channel: string): void {
  connection.channels.delete(channel);
}

export function channelsOf(connection: SweetSocketConnection): string[] {
  return [...connection.channels];
}

export function send(connection: SweetSocketConnection, message: object): void {
  try {
    if (connection.ws.readyState === OPEN) connection.ws.send(JSON.stringify(message));
  } catch {
    // A closing socket is removed by its close handler; an individual send must
    // never interrupt fanout to other clients.
  }
}

export function broadcast(channel: string, event: object): void {
  const message = { type: "event", event };
  for (const connection of connections.values()) {
    if (connection.channels.has(channel)) send(connection, message);
  }
}

export function broadcastUsers(userIds: string[], event: object): void {
  const recipients = new Set(userIds);
  for (const connection of connections.values()) {
    if (recipients.has(connection.userId)) send(connection, { type: "event", event });
  }
}

export function connectionCount(): number {
  return connections.size;
}
