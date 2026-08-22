/**
 * Cross-instance realtime bus (Redis Streams).
 *
 * A WebSocket connection is pinned to ONE Vercel Function instance. The local
 * hub (lib/realtime/hub.ts) covers delivery within an instance; this bus
 * covers delivery ACROSS instances, following the architecture of Vercel's
 * real-time chat guide (vercel.com/kb/guide/real-time-chat-websockets):
 *
 *   1. The emitting instance broadcasts locally first (instant), then XADDs
 *      the event to a Redis stream tagged with its instance id (`o`).
 *   2. Every OTHER active instance keeps ONE blocking reader (XREAD BLOCK) on
 *      the stream — "wait until Redis has something new", never poll. It
 *      forwards entries to its own local subscribers, skipping entries it
 *      emitted itself (`o === instanceId`).
 *   3. With no `REDIS_URL` the bus is a no-op and the app runs as a
 *      single-instance local realtime system (the durable Turso outbox still
 *      provides reconnect recovery). No extra infrastructure is introduced
 *      until Redis is actually configured.
 *
 * REQUIRED ENV VARS (only when multi-instance fan-out is wanted):
 *   REDIS_URL — a wire-protocol URL (`rediss://...`; TLS implied by scheme),
 *   e.g. Upstash's Redis connection string. Absent ⇒ single-instance fallback.
 *   Alternatively, provide the Upstash REST pair and the wire URL is derived:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 */

import Redis from "ioredis";
import { randomUUID } from "crypto";
import { broadcast } from "./hub";
import type { RealtimeEvent } from "./types";

/**
 * Resolve the Redis wire-protocol URL from env. Prefers an explicit
 * `REDIS_URL`; otherwise derives `rediss://default:<token>@<host>:6379` from
 * the Upstash REST pair (same host, TLS Redis protocol endpoint).
 */
function resolveRedisUrl(): string | undefined {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && token) {
    try {
      const host = new URL(restUrl).hostname;
      return `rediss://default:${encodeURIComponent(token)}@${host}:6379`;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function createRedis(): Redis | null {
  const url = resolveRedisUrl();
  if (!url) return null;
  // `maxRetriesPerRequest: null` keeps a long-lived blocking read from being
  // killed by ioredis's per-command retry cap; the read loop re-issues XREAD
  // from its saved cursor on error instead.
  return new Redis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
}

/** Per-instance id — used to skip self-echo on the shared stream. */
export const instanceId = randomUUID();

const STREAM = "meetsweet:events";
const STREAM_MAXLEN = 500; // cap the event stream (~trimmed)
const BLOCK_MS = 5_000; // XREAD BLOCK timeout — wakes the loop to observe shutdown
const RETRY_MS = 1_000; // brief backoff between read-loop retries

/** Singleton client for the whole Function instance (null ⇒ no Redis). */
export const redis = createRedis();

// ── Per-instance stream reader state ────────────────────────────────────────
let streamClient: Redis | null = null;
let streaming = false;
let lastEventId = "0-0";
let connectionCount = 0;

/** A connection arrived on this instance — ensure the reader is running. */
export function registerBusConnection(): void {
  connectionCount += 1;
  void startStream();
}

/** A connection left — stop the reader once the instance holds none. */
export function unregisterBusConnection(): void {
  connectionCount = Math.max(0, connectionCount - 1);
  if (connectionCount === 0) stopStream();
}

/**
 * Publish a realtime event to the shared bus so OTHER instances can deliver
 * it to their local subscribers. The emitting instance already broadcast it
 * locally before calling this. No-op without Redis.
 */
export async function publishEvent(event: RealtimeEvent): Promise<void> {
  if (!redis) return;
  try {
    await redis.xadd(
      STREAM,
      "MAXLEN", "~", STREAM_MAXLEN,
      "*",
      "d", JSON.stringify(event),
      "o", instanceId,
    );
  } catch {
    // Bus is best-effort — delivery degrades to the single-instance path.
  }
}

function flatToObject(flat: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) obj[flat[i]] = flat[i + 1];
  return obj;
}

function parseEvent(json: string | undefined): RealtimeEvent | null {
  if (!json) return null;
  try {
    const e = JSON.parse(json) as RealtimeEvent;
    if (!e || typeof e.id !== "string" || typeof e.type !== "string" || typeof e.channel !== "string") {
      return null;
    }
    return e;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Blocking read loop — relays remote instances' events to local subscribers. */
async function runReadLoop(): Promise<void> {
  while (streaming && streamClient) {
    try {
      const res = (await streamClient.xread(
        "BLOCK",
        BLOCK_MS,
        "STREAMS",
        STREAM,
        lastEventId,
      )) as Array<[string, Array<[string, string[]]>]> | null;

      if (!res) continue; // BLOCK timed out — loop again (observes shutdown)

      for (const [, entries] of res) {
        for (const [id, flat] of entries) {
          lastEventId = id;
          const fields = flatToObject(flat);
          if (fields.o === instanceId) continue; // our own — already delivered locally
          const event = parseEvent(fields.d);
          if (event) broadcast(event.channel, event);
        }
      }
    } catch {
      if (!streaming) break;
      await sleep(RETRY_MS); // ioredis reconnects the socket under us
    }
  }
}

async function startStream(): Promise<void> {
  if (!redis) return; // single-instance fallback — nothing to read
  if (streaming) return;
  // Claim the reader connection SYNCHRONOUSLY (before any await) so a second
  // concurrent register() bails at the `streaming` guard above.
  streamClient = redis.duplicate();
  streaming = true;
  // Seed from the stream tail so this instance only relays NEW entries.
  try {
    const tail = await redis.xrevrange(STREAM, "+", "-", "COUNT", 1);
    lastEventId = tail[0]?.[0] ?? "0-0";
  } catch {
    lastEventId = "0-0";
  }
  void runReadLoop();
}

function stopStream(): void {
  streaming = false;
  if (streamClient) {
    void streamClient.quit().catch(() => {});
    streamClient = null;
  }
}
