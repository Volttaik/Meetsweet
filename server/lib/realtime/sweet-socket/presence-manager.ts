import type { SweetSocketConnection } from "./types";

const users = new Map<string, number>();

export function connected(connection: SweetSocketConnection): boolean {
  const count = (users.get(connection.userId) ?? 0) + 1;
  users.set(connection.userId, count);
  return count === 1;
}

export function disconnected(connection: SweetSocketConnection): boolean {
  const count = Math.max(0, (users.get(connection.userId) ?? 1) - 1);
  if (count === 0) users.delete(connection.userId);
  else users.set(connection.userId, count);
  return count === 0;
}

export function isConnected(userId: string): boolean {
  return (users.get(userId) ?? 0) > 0;
}
