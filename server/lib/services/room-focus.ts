/**
 * Room focus registry — which user is ACTIVELY VIEWING which chat room.
 *
 * In-memory, best-effort, per-instance. Fed by the `chat:open` / `chat:close`
 * relays every DM screen announces on mount/unmount. Used to suppress OS push
 * notifications for a conversation the recipient is currently looking at:
 * if the app is open on the room, the realtime event is the only signal the
 * user needs — a duplicate native banner for that same room is noise.
 *
 * Never persisted. Cleared when a user's last connection drops so a stale
 * entry can never permanently mute their notifications.
 */

const focusedByRoom = new Map<string, Set<string>>();

export function setRoomFocused(roomId: string, userId: string, focused: boolean): void {
  if (!roomId || !userId) return;
  if (!focused) {
    const users = focusedByRoom.get(roomId);
    users?.delete(userId);
    if (users && users.size === 0) focusedByRoom.delete(roomId);
    return;
  }
  const users = focusedByRoom.get(roomId) ?? new Set<string>();
  users.add(userId);
  focusedByRoom.set(roomId, users);
}

export function isUserFocusedOnRoom(roomId: string, userId: string): boolean {
  return focusedByRoom.get(roomId)?.has(userId) ?? false;
}

/** Drop every room-focus entry for a user (connection teardown / logout). */
export function clearUserRoomFocus(userId: string): void {
  if (!userId) return;
  for (const [roomId, users] of focusedByRoom) {
    if (users.delete(userId) && users.size === 0) focusedByRoom.delete(roomId);
  }
}
