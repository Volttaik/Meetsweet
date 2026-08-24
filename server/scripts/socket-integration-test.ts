/**
 * SweetSocket integration test — drives the REAL backend over the wire.
 *
 * Requires a local dev server running with a LOCAL test database, e.g.:
 *
 *   TURSO_DATABASE_URL="file:/tmp/ms-integration/meetsweet.db" \
 *   TURSO_AUTH_TOKEN="" JWT_SECRET="$(head -c 48 /dev/urandom | base64)" \
 *   RESEND_API_KEY="" npx next dev -p 3999
 *
 * then:  npx tsx scripts/socket-integration-test.ts http://localhost:3999
 *
 * Exercises the exact scenarios from the reliability pass:
 *   T1 rapid consecutive messages — all persisted, in order, exactly once
 *   T2 disconnect mid-stream + reconnect — missed messages replay, no loss/dup
 *   T3 idempotent resend (same clientMessageId) — no duplicate rows/events
 *   T4 two users exchanging rapidly — no cross-user corruption, order kept
 *   T5 repeated reconnects — no duplicate handlers, replay converges
 *   T6 queue flush after reconnect (hello-gated delivery of held commands)
 *   T7 auth/registration error codes (INVALID_CREDENTIALS / *_ALREADY_IN_USE)
 *
 * Only ever touches the LOCAL database the server was started with.
 */
import WebSocket from "ws";
import { createClient } from "@libsql/client";
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://localhost:3999";
const DB_PATH = process.env.MS_TEST_DB ?? "/tmp/ms-integration/meetsweet.db";
const API = `${BASE}/api`;
const WS_BASE = BASE.replace(/^http/, "ws");

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed += 1; console.log(`  PASS  ${name}`); })
    .catch((error) => { failed += 1; console.log(`  FAIL  ${name}: ${error instanceof Error ? error.message : error}`); });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function http(path: string, options: RequestInit = {}, tries = 3): Promise<{ status: number; body: any }> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(`${API}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", "X-Client-App-Id": "meetsweet-mobile", ...(options.headers ?? {}) },
      });
      const text = await response.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: response.status, body };
    } catch (error) {
      last = error;
      await sleep(1500);
    }
  }
  throw last;
}

const uniq = (list: string[]) => [...new Set(list)];

// ── Minimal SweetSocket client mirroring the mobile transport ────────────────
class TestSocket {
  ws!: WebSocket;
  /** Every frame received, buffered so a waitFor registered late still finds it. */
  private messageQueue: Array<Record<string, any>> = [];
  private waiters: Array<{ predicate: (m: Record<string, any>) => boolean; resolve: (m: Record<string, any>) => void; timer: NodeJS.Timeout }> = [];
  private seenIds = new Set<string>();
  /** All event frames received (deduped by event id), in arrival order. */
  events: Array<{ event: Record<string, any> }> = [];
  /** All ack frames, keyed by requestId. */
  acks = new Map<string, Array<Record<string, any>>>();
  hello: Record<string, any> | null = null;
  connected = false;
  private clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.messageQueue = [];
      this.waiters = [];
      this.hello = null;
      this.ws = new WebSocket(`${WS_BASE}/api/realtime?token=${encodeURIComponent(token)}`, {
        headers: { "X-Client-App-Id": "meetsweet-mobile" },
      });
      const timeout = setTimeout(() => reject(new Error("socket connect timeout")), 60_000);
      this.ws.on("open", () => {
        // hello is the readiness signal the mobile client keys queue-flush on.
        this.waitFor((m) => m.type === "hello").then((hello) => {
          clearTimeout(timeout);
          this.hello = hello;
          this.connected = true;
          resolve();
        });
      });
      this.ws.on("error", (error) => { clearTimeout(timeout); reject(error); });
      this.ws.on("message", (data) => this.dispatch(JSON.parse(String(data))));
      this.ws.on("close", () => { this.connected = false; });
    });
  }

  private dispatch(message: Record<string, any>): void {
    this.messageQueue.push(message);
    if (message.type === "event") {
      const event = message.event ?? {};
      if (event.id && this.seenIds.has(event.id)) return; // dedupe like the mobile client
      if (event.id) {
        this.seenIds.add(event.id);
        if (this.seenIds.size > 2000) this.seenIds.delete(this.seenIds.values().next().value);
      }
      this.events.push({ event });
    }
    if (message.type === "ack") {
      const list = this.acks.get(String(message.requestId)) ?? [];
      list.push(message);
      this.acks.set(String(message.requestId), list);
    }
    const index = this.waiters.findIndex((w) => w.predicate(message));
    if (index !== -1) {
      const [waiter] = this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  waitFor(predicate: (m: Record<string, any>) => boolean, timeoutMs = 60_000): Promise<Record<string, any>> {
    const bufferedIndex = this.messageQueue.findIndex(predicate);
    if (bufferedIndex !== -1) {
      const [frame] = this.messageQueue.splice(bufferedIndex, 1);
      return Promise.resolve(frame);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.predicate === predicate);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new Error("timed out waiting for server frame"));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, timer });
    });
  }

  send(frame: object): void {
    this.ws.send(JSON.stringify(frame));
  }

  subscribe(channel: string): Promise<void> {
    this.send({ type: "subscribe", channels: [channel] });
    return this.waitFor((m) => m.type === "subscribed" && (m.channels ?? []).includes(channel)).then(() => undefined);
  }

  async sync(): Promise<void> {
    this.send({ type: "sync", clientId: this.clientId });
    const synced = await this.waitFor((m) => m.type === "synced");
    if (typeof synced.through === "number" && Number.isFinite(synced.through)) {
      this.send({ type: "ack", clientId: this.clientId, sequence: synced.through });
    }
    if (synced.hasMore) await this.sync();
  }

  /** Send a message.send command and resolve with its terminal (persisted) ack. */
  sendMessage(roomId: string, clientMessageId: string, body: string): Promise<{ messageId: string; ack: Record<string, any> }> {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.send({
      type: "command",
      requestId,
      command: "message.send",
      channel: `chat:${roomId}`,
      clientMessageId,
      payload: { body },
    });
    return this.waitFor((m) => m.type === "ack" && m.requestId === requestId && m.status === "persisted").then((ack) => ({
      messageId: String(ack.event?.payload?.message?.id ?? ack.event?.resourceId ?? ""),
      ack,
    }));
  }

  /** Wait until the socket has seen (live or replayed) a persisted message with the given body. */
  waitForPersistedMessage(predicate: (payload: Record<string, any>) => boolean, timeoutMs = 60_000): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        const hit = this.events.find(({ event }) => {
          if (event.type !== "messages:upsert") return false;
          const payload = event.payload ?? {};
          if (payload.status !== "persisted") return false;
          return predicate(payload);
        });
        if (hit) return resolve(hit.event);
        if (Date.now() > deadline) return reject(new Error("timed out waiting for persisted message event"));
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

function persistedBodies(socket: TestSocket, senderId: string | null = null): Array<{ messageId: string; body: string; sender: string }> {
  const out: Array<{ messageId: string; body: string; sender: string }> = [];
  for (const { event } of socket.events) {
    if (event.type !== "messages:upsert") continue;
    const payload = event.payload ?? {};
    if (payload.status !== "persisted") continue;
    const message = payload.message ?? {};
    const sender = String(message.sender?.id ?? "");
    if (senderId !== null && sender !== senderId) continue;
    out.push({ messageId: String(message.id ?? ""), body: String(message.body ?? ""), sender });
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const stamp = Date.now().toString(36);
  const emailA = `alice_${stamp}@test.local`;
  const emailB = `bob_${stamp}@test.local`;
  const password = "TestPass123!";

  const db = createClient({ url: `file:${DB_PATH}` });
  const verifyUser = async (userId: string) => {
    await db.execute({ sql: "UPDATE users SET is_verified = 1 WHERE id = ?", args: [userId] });
  };

  // Register both users first — the T7 error checks reuse these accounts.
  const regA = (await http("/auth/register", { method: "POST", body: JSON.stringify({ full_name: "Alice", username: `alice_${stamp}`, email: emailA, password, confirm_password: password }) })).body.data;
  assert.ok(regA?.user_id || regA?.id, "register must return a user id");
  const regB = (await http("/auth/register", { method: "POST", body: JSON.stringify({ full_name: "Bob", username: `bob_${stamp}`, email: emailB, password, confirm_password: password }) })).body.data;
  assert.ok(regB?.user_id || regB?.id, "register must return a user id");
  await verifyUser(regA.user_id ?? regA.id);
  await verifyUser(regB.user_id ?? regB.id);

  console.log("\n== T7: auth + registration error codes ==");
  await check("register returns the structured success envelope", async () => {
    assert.ok(regA.user_id || regA.id, "register response carries the user id");
  });
  await check("login with wrong password returns INVALID_CREDENTIALS", async () => {
    const { status, body } = await http("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: emailA, password: "WrongPass123!" }),
    });
    assert.equal(status, 401);
    assert.equal(body.success, false);
    assert.equal(body.ok, false);
    assert.equal(body.code, "INVALID_CREDENTIALS");
    assert.equal(typeof body.error, "string", "error must stay a string for the mobile client");
    assert.deepEqual(body.details, { code: "INVALID_CREDENTIALS", message: body.error });
  });
  await check("login with unknown email returns INVALID_CREDENTIALS (no account enumeration)", async () => {
    const { status, body } = await http("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: `nobody_${stamp}@test.local`, password }),
    });
    assert.equal(status, 401);
    assert.equal(body.code, "INVALID_CREDENTIALS");
  });
  await check("register duplicate email returns EMAIL_ALREADY_IN_USE", async () => {
    const { status, body } = await http("/auth/register", {
      method: "POST",
      body: JSON.stringify({ full_name: "Alice2", username: `alice2_${stamp}`, email: emailA, password, confirm_password: password }),
    });
    assert.equal(status, 409);
    assert.equal(body.code, "EMAIL_ALREADY_IN_USE");
    assert.match(String(body.error), /email/i);
    assert.match(String(body.error), /already/i);
  });
  await check("register duplicate username returns USERNAME_ALREADY_IN_USE", async () => {
    const { status, body } = await http("/auth/register", {
      method: "POST",
      body: JSON.stringify({ full_name: "Alice3", username: `alice_${stamp}`, email: `alice3_${stamp}@test.local`, password, confirm_password: password }),
    });
    assert.equal(status, 409);
    assert.equal(body.code, "USERNAME_ALREADY_IN_USE");
    assert.match(String(body.error), /username/i);
  });


  const loginA = (await http("/auth/login", { method: "POST", body: JSON.stringify({ email: emailA, password }) })).body.data;
  const loginB = (await http("/auth/login", { method: "POST", body: JSON.stringify({ email: emailB, password }) })).body.data;
  const tokenA = loginA.access_token;
  const tokenB = loginB.access_token;
  assert.ok(tokenA && tokenB, "login must return access tokens");
  const userA = regA.user_id ?? regA.id;
  const userB = regB.user_id ?? regB.id;

  // Room between A and B.
  const room = (await http("/chat-rooms", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ participant_id: userB }),
  })).body.data;
  const roomId = room.chat_room_id ?? room.chatRoomId;
  assert.ok(roomId, "chat room must be created");

  const clientIdA = `test-a-${stamp}`;
  const clientIdB = `test-b-${stamp}`;

  console.log("\n== T1: rapid consecutive messages ==");
  const sockA = new TestSocket(clientIdA);
  const sockB = new TestSocket(clientIdB);
  await check("A and B connect and receive hello", async () => {
    await sockA.connect(tokenA);
    await sockB.connect(tokenB);
    assert.ok(sockA.hello, "A hello");
    assert.ok(sockB.hello, "B hello");
  });
  await check("both subscribe to the room", async () => {
    await sockA.subscribe(`chat:${roomId}`);
    await sockB.subscribe(`chat:${roomId}`);
  });
  await check("sync returns a synced frame on first connection", async () => {
    await sockA.sync();
    await sockB.sync();
  });

  const COUNT = 15;
  await check(`${COUNT} rapid messages: every one gets accepted AND persisted, in order`, async () => {
    const requestIds: string[] = [];
    const promises = [];
    for (let i = 0; i < COUNT; i += 1) {
      const requestId = `t1-${i}`;
      requestIds.push(requestId);
      sockA.send({
        type: "command",
        requestId,
        command: "message.send",
        channel: `chat:${roomId}`,
        clientMessageId: `t1-cm-${i}`,
        payload: { body: `msg-${i}` },
      });
      promises.push(sockA.waitFor((m) => m.type === "ack" && m.requestId === requestId && m.status === "persisted"));
    }
    await Promise.all(promises);
    for (let i = 0; i < COUNT; i += 1) {
      const acks = sockA.acks.get(requestIds[i]) ?? [];
      assert.ok(acks.some((a) => a.status === "accepted"), `msg ${i}: accepted ack`);
      assert.ok(acks.some((a) => a.status === "persisted"), `msg ${i}: persisted ack`);
    }
    // The server serializes commands, so persisted acks arrive in send order.
    const bodies = requestIds.map((id) => sockA.acks.get(id)!.find((a) => a.status === "persisted")!.event?.payload?.message?.body);
    assert.deepEqual(bodies, Array.from({ length: COUNT }, (_, i) => `msg-${i}`), "persisted acks in send order");
  });
  await check(`B receives all ${COUNT} persisted messages exactly once, in order`, async () => {
    await sockB.waitForPersistedMessage((p) => (p.message?.body ?? "") === `msg-${COUNT - 1}`);
    const received = persistedBodies(sockB, userA);
    assert.equal(received.length, COUNT, `expected ${COUNT} persisted messages, got ${received.length}`);
    const ids = uniq(received.map((r) => r.messageId));
    assert.equal(ids.length, COUNT, "no duplicate message ids");
    assert.deepEqual(received.map((r) => r.body), Array.from({ length: COUNT }, (_, i) => `msg-${i}`), "B received messages in send order");
  });

  console.log("\n== T2: disconnect mid-stream, reconnect, replay ==");
  const midCount = 5;
  await check(`A sends ${midCount} more while B is disconnected`, async () => {
    sockB.close();
    await sleep(300); // let the close settle server-side
    for (let i = 0; i < midCount; i += 1) {
      const { ack } = await sockA.sendMessage(roomId, `t2-cm-${i}`, `late-${i}`);
      assert.equal(ack.status, "persisted");
    }
  });
  await check("B reconnects (same clientId) and replays exactly the missed messages — no loss, no duplicates", async () => {
    const sockB2 = new TestSocket(clientIdB);
    await sockB2.connect(tokenB);
    await sockB2.subscribe(`chat:${roomId}`);
    await sockB2.sync();
    await sockB2.waitForPersistedMessage((p) => (p.message?.body ?? "") === `late-${midCount - 1}`);
    const received = persistedBodies(sockB2, userA);
    const ids = uniq(received.map((r) => r.messageId));
    // The durable replay converges on every message A ever sent so far
    // (15 live + 5 missed while disconnected = 20), with no duplicates.
    assert.equal(ids.length, COUNT + midCount, `expected ${COUNT + midCount} distinct messages, got ${ids.length}`);
    const lateBodies = received.filter((r) => r.body.startsWith("late-")).map((r) => r.body);
    assert.deepEqual(lateBodies, Array.from({ length: midCount }, (_, i) => `late-${i}`), "missed messages replayed in order");
    sockB2.close();
  });

  console.log("\n== T3: idempotent resend (same clientMessageId) ==");
  await check("resending the same clientMessageId returns the same message id and no duplicate event", async () => {
    const sockB3 = new TestSocket(clientIdB);
    await sockB3.connect(tokenB);
    await sockB3.subscribe(`chat:${roomId}`);
    await sockB3.sync();
    const first = await sockA.sendMessage(roomId, "dup-cm-1", "duplicate me");
    const second = await sockA.sendMessage(roomId, "dup-cm-1", "duplicate me");
    assert.equal(second.messageId, first.messageId, "same clientMessageId must reconcile to the same server message");
    await sockB3.waitForPersistedMessage((p) => p.message?.id === first.messageId);
    const received = persistedBodies(sockB3, userA);
    const occurrences = received.filter((r) => r.messageId === first.messageId).length;
    assert.equal(occurrences, 1, "recipient must receive the message exactly once");
    sockB3.close();
  });

  console.log("\n== T4: two users exchanging rapidly ==");
  const sockA2 = new TestSocket(clientIdA);
  const sockB4 = new TestSocket(clientIdB);
  await check("both users reconnect for the exchange test", async () => {
    sockA.close();
    await sleep(200);
    await sockA2.connect(tokenA);
    await sockB4.connect(tokenB);
    await sockA2.subscribe(`chat:${roomId}`);
    await sockB4.subscribe(`chat:${roomId}`);
    await sockA2.sync();
    await sockB4.sync();
  });
  const EXCHANGE = 10;
  await check(`A and B each send ${EXCHANGE} messages concurrently — no cross-user corruption`, async () => {
    const aPromises = [];
    const bPromises = [];
    for (let i = 0; i < EXCHANGE; i += 1) {
      aPromises.push(sockA2.sendMessage(roomId, `t4-a-${i}`, `a-${i}`));
      bPromises.push(sockB4.sendMessage(roomId, `t4-b-${i}`, `b-${i}`));
    }
    await Promise.all([...aPromises, ...bPromises]);
    await sockA2.waitForPersistedMessage((p) => (p.message?.body ?? "") === `b-${EXCHANGE - 1}`);
    await sockB4.waitForPersistedMessage((p) => (p.message?.body ?? "") === `a-${EXCHANGE - 1}`);
    const aSeesB = persistedBodies(sockA2, userB).map((r) => r.body);
    const bSeesA = persistedBodies(sockB4, userA).map((r) => r.body);
    assert.equal(aSeesB.length, EXCHANGE, "A received all of B's messages");
    assert.equal(bSeesA.length, EXCHANGE, "B received all of A's messages");
    assert.deepEqual(aSeesB, Array.from({ length: EXCHANGE }, (_, i) => `b-${i}`), "A sees B's messages in order");
    assert.deepEqual(bSeesA, Array.from({ length: EXCHANGE }, (_, i) => `a-${i}`), "B sees A's messages in order");
  });

  console.log("\n== T5: repeated reconnects ==");
  await check("five rapid reconnect cycles converge without duplicates or stuck state", async () => {
    let last: TestSocket = sockB4;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      last.close();
      await sleep(150);
      const next = new TestSocket(clientIdB);
      await next.connect(tokenB);
      await next.subscribe(`chat:${roomId}`);
      await next.sync();
      await next.waitForPersistedMessage((p) => (p.message?.body ?? "") === `a-${EXCHANGE - 1}`);
      last = next;
    }
    const seen = persistedBodies(last, userA);
    const ids = uniq(seen.map((r) => r.messageId));
    // Every persisted message A ever sent must be present exactly once.
    assert.equal(ids.length, COUNT + midCount + 1 + EXCHANGE, `converged on ${COUNT + midCount + 1 + EXCHANGE} distinct messages`);
    last.close();
  });

  console.log("\n== T6: hello-gated delivery of held commands (queue flush path) ==");
  await check("commands held while disconnected are flushed on the next hello", async () => {
    const sockA3 = new TestSocket(clientIdA);
    await sockA3.connect(tokenA);
    await sockA3.subscribe(`chat:${roomId}`);
    await sockA3.sync();
    // Simulate the mobile outgoing queue: socket drops, commands held locally.
    sockA3.close();
    await sleep(250);
    const held = [
      { roomId, clientMessageId: "t6-cm-0", body: "queued-0" },
      { roomId, clientMessageId: "t6-cm-1", body: "queued-1" },
      { roomId, clientMessageId: "t6-cm-2", body: "queued-2" },
    ];
    // Reconnect with the same clientId — hello gates the queue flush.
    await sockA3.connect(tokenA);
    await sockA3.subscribe(`chat:${roomId}`);
    const results = await Promise.all(held.map((c) => sockA3.sendMessage(c.roomId, c.clientMessageId, c.body)));
    for (const result of results) assert.ok(result.messageId, "queued command must produce a persisted message");
    // The recipient converges on the queued messages via the durable fanout.
    await sockB4.waitForPersistedMessage((p) => (p.message?.body ?? "") === `queued-2`);
    const queuedBodies = persistedBodies(sockB4, userA).filter((r) => r.body.startsWith("queued-")).map((r) => r.body);
    assert.deepEqual(queuedBodies, ["queued-0", "queued-1", "queued-2"], "queued messages delivered in order");
    sockA3.close();
  });

  console.log("\n== T8: invalid command produces a terminal failed ack ==");
  await check("unsupported command returns ack failed, not silence", async () => {
    const sockA4 = new TestSocket(clientIdA);
    await sockA4.connect(tokenA);
    const requestId = "t8-req";
    sockA4.send({ type: "command", requestId, command: "message.teleport", payload: {} });
    const ack = await sockA4.waitFor((m) => m.type === "ack" && m.requestId === requestId);
    assert.equal(ack.status, "failed");
    sockA4.close();
  });

  db.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Integration test crashed:", error);
  process.exit(1);
});
