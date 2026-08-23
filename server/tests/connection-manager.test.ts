import { test } from "node:test";
import assert from "node:assert/strict";
import * as manager from "../lib/realtime/sweet-socket/connection-manager";
import type { WebSocket } from "ws";

/** Minimal fake WebSocket: tracks sent frames and close events. */
function fakeWs() {
  const sent: string[] = [];
  const closed: Array<{ code: number; reason: string }> = [];
  const handlers: Record<string, () => void> = {};
  const ws = {
    readyState: 1,
    sent,
    closed,
    handlers,
    send(data: string) { sent.push(data); },
    close(code = 1000, reason = "") {
      closed.push({ code, reason });
      ws.readyState = 3;
      handlers.close?.();
    },
    on(event: string, fn: () => void) { handlers[event] = fn; },
  };
  return ws as unknown as WebSocket & {
    sent: string[];
    closed: Array<{ code: number; reason: string }>;
    handlers: Record<string, () => void>;
  };
}

type FakeWs = ReturnType<typeof fakeWs>;

/** Close every socket created during a test so the shared module map stays clean. */
function cleanup(...wss: FakeWs[]): void {
  for (const ws of wss) ws.handlers.close?.();
}

test("register creates a connection bound to the authenticated userId", () => {
  const ws = fakeWs();
  try {
    const conn = manager.register(ws, "user_1");
    assert.ok(conn.id);
    assert.equal(conn.userId, "user_1");
    assert.ok(conn.authenticatedAt > 0);
    assert.equal(manager.connectionCount(), 1);
    assert.equal(manager.connectionsForUser("user_1").length, 1);
  } finally {
    cleanup(ws);
  }
});

test("close unregisters the connection and drops the user bucket", () => {
  const ws = fakeWs();
  manager.register(ws, "user_1");
  ws.handlers.close?.();
  assert.equal(manager.connectionCount(), 0);
  assert.equal(manager.connectionsForUser("user_1").length, 0);
});

test("subscribe/broadcast fans out only to members of the channel", () => {
  const a = fakeWs();
  const b = fakeWs();
  const c = fakeWs();
  try {
    const connA = manager.register(a, "user_1");
    manager.register(b, "user_2");
    manager.register(c, "user_3");
    manager.subscribe(connA, "chat:room_1");
    manager.subscribe(connA, "chat:room_2");
    const event = { type: "event", event: { id: "e1", type: "messages:upsert", channel: "chat:room_1" } };
    manager.broadcast("chat:room_1", event);
    assert.equal(a.sent.length, 1);
    assert.equal(b.sent.length, 0);
    assert.equal(c.sent.length, 0);
  } finally {
    cleanup(a, b, c);
  }
});

test("broadcastUsers targets the given userIds only", () => {
  const a = fakeWs();
  const b = fakeWs();
  try {
    manager.register(a, "user_1");
    manager.register(b, "user_2");
    manager.broadcastUsers(["user_1"], { type: "event", event: { id: "e1", type: "chats:upsert" } });
    assert.equal(a.sent.length, 1);
    assert.equal(b.sent.length, 0);
  } finally {
    cleanup(a, b);
  }
});

test("disconnectUser closes connections with a session code", () => {
  const ws = fakeWs();
  try {
    manager.register(ws, "user_1");
    manager.disconnectUser("user_1", 4401, "Session expired");
    assert.equal(ws.closed.length, 1);
    assert.equal(ws.closed[0].code, 4401);
  } finally {
    cleanup(ws);
  }
});

test("isUserSubscribedTo reflects live room membership per user", () => {
  const a = fakeWs();
  const b = fakeWs();
  const c = fakeWs(); // same user as b, not subscribed
  try {
    manager.register(a, "user_1");
    const connB = manager.register(b, "user_2");
    manager.register(c, "user_2");
    const connA = manager.connectionsForUser("user_1")[0];
    manager.subscribe(connA, "chat:room_1");
    manager.subscribe(connB, "chat:room_1");
    // user_2 has one of two sockets subscribing → considered online in the room.
    assert.equal(manager.isUserSubscribedTo("user_2", "chat:room_1"), true);
    assert.equal(manager.isUserSubscribedTo("user_1", "chat:room_1"), true);
    assert.equal(manager.isUserSubscribedTo("user_1", "chat:other"), false);
    assert.equal(manager.isUserSubscribedTo("ghost", "chat:room_1"), false);
  } finally {
    cleanup(a, b, c);
  }
});

test("send is safe on a closed socket", () => {
  const ws = fakeWs();
  const conn = manager.register(ws, "user_1");
  // The fake's close() sets readyState to CLOSED (3) and fires the close
  // handler — the send must no-op on a closed socket.
  ws.close(1000, "gone");
  manager.send(conn, { type: "pong" });
  assert.equal(ws.sent.length, 0);
});
