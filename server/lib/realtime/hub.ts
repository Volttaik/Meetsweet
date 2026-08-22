/** Compatibility facade for SweetSocket's connection manager. */
import type { WebSocket } from "ws";
import type { SweetSocketEvent, SweetSocketConnection } from "./sweet-socket/types";
import * as manager from "./sweet-socket/connection-manager";

export type Connection = SweetSocketConnection;

export function registerConnection(ws: WebSocket, userId: string): Connection {
  return manager.register(ws, userId);
}

export function sendTo(conn: Connection, message: object): void {
  manager.send(conn, message);
}

export function broadcast(channel: string, event: SweetSocketEvent | object): void {
  manager.broadcast(channel, event);
}

export function subscribe(conn: Connection, channel: string): void {
  manager.subscribe(conn, channel);
}

export function unsubscribe(conn: Connection, channel: string): void {
  manager.unsubscribe(conn, channel);
}

export function channelsOf(conn: Connection): string[] {
  return manager.channelsOf(conn);
}

export function touch(conn: Connection): void {
  manager.touch(conn);
}

export function connectionCount(): number {
  return manager.connectionCount();
}
