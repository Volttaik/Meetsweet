/**
 * End-to-end SweetSocket verification (dev-only, run with `npx tsx`).
 *
 * Boots two WebSocket clients against a running server and verifies the
 * critical realtime flows:
 *   1. authenticated handshake + connection lifecycle frames
 *   2. message.send → messages:upsert to both participants
 *   3. chats:upsert on the recipient's private user channel (new-room fanout)
 *   4. chat.history command → history:set with durable messages
 *   5. typing relay → typing:start to the other participant
 *   6. idempotent send (same clientMessageId twice → one DB row)
 *   7. relay rate limiting (error:rate-limit after the budget is exhausted)
 *
 * Usage:  npx tsx scripts/verify-realtime.ts
 * Requires a running server (next start) and the .env Turso credentials.
 */

import WebSocket from "ws";
import { SignJWT } from "jose";
import { createClient } from "@libsql/client";
import { config } from "@/lib/config";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3100";
const WS_BASE = BASE.replace(/^http/, "ws");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sign(userId: string, role = "user"): Promise<string> {
  const secret = config.auth.jwtSecret();
  if (!secret) throw new Error("JWT_SECRET is required");
  return new SignJWT({ userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));
}

interface Client {
  ws: WebSocket;
  inbox: Array<Record<string, unknown>>;
  waitFor: (pred: (m: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
}

function connect(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { "X-Client-App-Id": "meetsweet-mobile" } });
    const inbox: Array<Record<string, unknown>> = [];
    const waiters: Array<{ pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void; timer: NodeJS.Timeout }> = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(msg)) {
          clearTimeout(waiters[i].timer);
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on("open", () => {
      resolve({
        ws,
        inbox,
        waitFor: (pred, timeoutMs = 8000) =>
          new Promise((res, rej) => {
            const hit = inbox.find(pred);
            if (hit) return res(hit);
            const timer = setTimeout(() => rej(new Error("timeout waiting for frame")), timeoutMs);
            waiters.push({ pred, resolve: res, timer });
          }),
      });
    });
    ws.on("error", (e) => reject(e));
  });
}

async function main() {
  const tursoUrl = config.turso.url();
  const tursoToken = config.turso.token();
  if (!tursoUrl || !tursoToken) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are required");
  const db = createClient({ url: tursoUrl, authToken: tursoToken });

  // Pick two active, non-deleted users.
  const users = await db.execute(
    `SELECT id FROM users WHERE is_active = 1 AND username NOT LIKE 'deleted_%' ORDER BY created_at DESC LIMIT 2`,
  );
  const [u1, u2] = users.rows.map((r) => String(r.id));
  if (!u1 || !u2) {
    console.error("Need two active users in the database");
    process.exit(1);
  }

  console.log(`users: ${u1} <-> ${u2}`);
  const t1 = await sign(u1);
  const t2 = await sign(u2);

  // ── 1. Authenticated handshake ───────────────────────────────────────────
  console.log("\n[1] handshake + lifecycle");
  const a = await connect(`${WS_BASE}/realtime?token=${encodeURIComponent(t1)}`);
  const b = await connect(`${WS_BASE}/realtime?token=${encodeURIComponent(t2)}`);
  await a.waitFor((m) => m.type === "auth" && m.state === "connected");
  await a.waitFor((m) => m.type === "auth" && m.state === "authenticated");
  const connReady = await a.waitFor((m) => m.type === "connection" && m.state === "ready");
  const hello = await a.waitFor((m) => m.type === "hello");
  ok("auth connected", true);
  ok("auth authenticated", true);
  ok("connection ready frame", connReady?.state === "ready");
  ok("hello with baseline sequence", typeof hello.sequence === "number" || hello.sequence === null);

  // ── Ensure a chat room exists between the two users ──────────────────────
  console.log("\n[2] chat room");
  const roomRes = await fetch(`${BASE}/api/chat-rooms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t1}`, "Content-Type": "application/json", "X-Client-App-Id": "meetsweet-mobile" },
    body: JSON.stringify({ participant_id: u2 }),
  });
  const roomBody = (await roomRes.json()) as { chat_room_id?: string };
  const roomId = roomBody.chat_room_id;
  ok("chat room created/found", !!roomId, JSON.stringify(roomBody));
  if (!roomId) process.exit(1);

  // ── 3. Subscriptions ─────────────────────────────────────────────────────
  a.ws.send(JSON.stringify({ type: "subscribe", channels: [`chat:${roomId}`] }));
  b.ws.send(JSON.stringify({ type: "subscribe", channels: [`chat:${roomId}`, `user:${u2}`] }));
  await a.waitFor((m) => m.type === "subscribed");
  await b.waitFor((m) => m.type === "subscribed");
  ok("both subscribed to chat channel", true);

  // ── 4. message.send → messages:upsert + chats:upsert ─────────────────────
  console.log("\n[3] message.send");
  const clientMessageId = `verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  a.ws.send(JSON.stringify({
    type: "command",
    requestId: "r-send-1",
    command: "message.send",
    channel: `chat:${roomId}`,
    clientMessageId,
    payload: { body: "sweet-socket-e2e", replyToId: null },
  }));

  const bUpsert = await b.waitFor((m) => {
    const e = m.event as Record<string, unknown> | undefined;
    return m.type === "event" && e?.type === "messages:upsert" && String((e.payload as any)?.clientMessageId) === clientMessageId && (e.payload as any)?.status === "persisted";
  });
  ok("recipient received messages:upsert (persisted)", !!bUpsert, JSON.stringify(bUpsert).slice(0, 200));

  const aUpsert = await a.waitFor((m) => {
    const e = m.event as Record<string, unknown> | undefined;
    return m.type === "event" && e?.type === "messages:upsert" && String((e.payload as any)?.clientMessageId) === clientMessageId;
  });
  ok("sender received messages:upsert echo", !!aUpsert);

  const chatsUpsert = await b.waitFor((m) => {
    const e = m.event as Record<string, unknown> | undefined;
    return m.type === "event" && e?.type === "chats:upsert" && (e.payload as any)?.roomId === roomId;
  }, 10000);
  const roomPayload = (chatsUpsert.event as any)?.payload?.room as { unreadCount?: number; lastMessageBody?: string } | undefined;
  ok("recipient received chats:upsert on user channel (no refetch)", !!chatsUpsert, JSON.stringify(chatsUpsert).slice(0, 200));
  ok("chats:upsert carries room preview + unread", roomPayload?.lastMessageBody === "sweet-socket-e2e" && (roomPayload?.unreadCount ?? 0) >= 1, JSON.stringify(roomPayload));

  // ── 5. chat.history command → history:set ────────────────────────────────
  console.log("\n[4] chat.history");
  b.ws.send(JSON.stringify({ type: "command", requestId: "r-hist-1", command: "chat.history", channel: `chat:${roomId}`, payload: { limit: 30 } }));
  const histAck = await b.waitFor((m) => m.type === "ack" && m.requestId === "r-hist-1");
  const histMsg = (histAck.event as any)?.payload?.messages as Array<{ body?: string }> | undefined;
  ok("history:set ack contains durable messages", Array.isArray(histMsg) && histMsg.some((m) => m.body === "sweet-socket-e2e"), JSON.stringify(histMsg).slice(0, 200));

  // ── 6. typing relay ──────────────────────────────────────────────────────
  console.log("\n[5] typing relay");
  a.ws.send(JSON.stringify({ type: "relay", channel: `chat:${roomId}`, eventType: "typing:start", payload: { userId: u1 } }));
  const typing = await b.waitFor((m) => {
    const e = m.event as Record<string, unknown> | undefined;
    return m.type === "event" && e?.type === "typing:start" && (e.payload as any)?.userId === u1;
  });
  ok("recipient received typing:start", !!typing);

  // ── 7. Idempotency: same clientMessageId twice → one DB row ──────────────
  console.log("\n[6] idempotent send");
  a.ws.send(JSON.stringify({
    type: "command",
    requestId: "r-send-2",
    command: "message.send",
    channel: `chat:${roomId}`,
    clientMessageId,
    payload: { body: "sweet-socket-e2e-dup" },
  }));
  await a.waitFor((m) => m.type === "ack" && m.requestId === "r-send-2" && m.status === "persisted");
  await sleep(1500);
  const count = await db.execute({
    sql: `SELECT count(*) AS c FROM chat_room_messages WHERE chat_room_id = ? AND client_message_id = ?`,
    args: [roomId, clientMessageId],
  });
  ok("duplicate clientMessageId produced exactly one row", Number(count.rows[0].c) === 1, `count=${count.rows[0].c}`);

  // ── 8. Relay rate limit ──────────────────────────────────────────────────
  console.log("\n[7] relay rate limiting");
  const errors: string[] = [];
  const errWaiter = b.waitFor((m) => m.type === "error" && m.code === "error:rate-limit").catch(() => null);
  for (let i = 0; i < 40; i++) {
    a.ws.send(JSON.stringify({ type: "relay", channel: `chat:${roomId}`, eventType: "presence:updated", payload: { userId: u1, online: true } }));
  }
  const err = await errWaiter;
  ok("error:rate-limit frame after flood", !!err, errors.join(","));
  // Confirm the flood did not reach the recipient (only the first 30 do).
  const received = b.inbox.filter((m) => {
    const e = m.event as Record<string, unknown> | undefined;
    return m.type === "event" && e?.type === "presence:updated";
  }).length;
  ok("relay flood capped", received <= 30, `received=${received}`);

  a.ws.close();
  b.ws.close();
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
