# Unified Realtime (WebSocket) Layer

MeetSweet's live experience moved from request/polling to a unified WebSocket
realtime system. This document describes the architecture, the event protocol,
authorization rules, deployment notes, and the test checklist.

## Architecture

```
                    ┌─────────────────────┐
                    │     TURSO DB        │  durable source of truth
                    └──────────▲──────────┘
                               │ persistence
                    ┌──────────┴──────────┐
                    │ NEXT.JS / VERCEL    │  existing backend (Fluid compute)
                    │  WebSocket endpoint │  /api/realtime + emitEvent()
                    └───────┬───────┬─────┘
                        realtime  │  realtime
                    ┌──────▼─┐ ┌──▼──────┐
                    │Device A│ │Device B │
                    └────────┘ └─────────┘
```

- **Turso** remains the durable source of truth. The WebSocket only NOTIFIES
  clients that something changed; every event is emitted AFTER the
  authoritative database write.
- **Local SQLite** (mobile) remains the instant local source — realtime events
  write through the same SQLite path (`cacheMessages`, comment state, etc.).
- **REST/API** continues to handle data retrieval, pagination, mutations and
  uploads. WebSockets are for events and state propagation only.

## Server modules (`lib/realtime/`)

| Module | Role |
|---|---|
| `types.ts` | Event/channel constants, protocol types, relay allow-list |
| `hub.ts` | Per-Function-instance connection registry + channel fan-out |
| `bus.ts` | **Cross-instance Redis Streams bus** (`XREAD BLOCK`, no polling) — see below |
| `outbox.ts` | Durable event log on Turso (`realtime_events`), sequence numbers, missed-event recovery, pruning |
| `emit.ts` | `emitEvent()` — the single publish entry point (outbox + local fan-out + bus) |
| `app/api/realtime/route.ts` | The WebSocket endpoint (auth, subscribe, ping, sync, relay) |

### Cross-instance delivery (Redis Streams bus) — follows the Vercel chat guide

A connection is pinned to ONE Function instance. `hub.ts` covers delivery
within an instance; **`bus.ts` covers delivery across instances** using the
architecture from Vercel's real-time chat guide
(vercel.com/kb/guide/real-time-chat-websockets):

1. The emitting instance broadcasts locally first (instant), then `XADD`s the
   event to the `meetsweet:events` stream tagged with its instance id (`o`).
2. Every other active instance keeps ONE blocking reader
   (`XREAD BLOCK 5000`) on the stream — *wait until Redis has something new*,
   never poll. It forwards entries to its own local subscribers, skipping
   entries it emitted itself (`o === instanceId`).
3. The reader is claimed synchronously (a `streaming` guard set before any
   `await`), seeded from the stream tail, and stopped when the instance holds
   no connections. `ioredis` is in `serverExternalPackages` (Node built-ins).

**Required env vars (only when multi-instance fan-out is wanted):**

```
# Either the wire-protocol URL directly (ioredis, TLS):
REDIS_URL=rediss://default:...@your-db.upstash.io:6379
# …or the Upstash REST pair, from which the wire URL is derived automatically:
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

Set these in Vercel (Settings → Environment Variables → Production/Preview) and
in the server's local `.env` (`vercel env pull` pulls them).

With no `REDIS_URL` the bus is a no-op and the app runs as a single-instance
local realtime system — **no extra infrastructure is introduced until Redis is
actually configured.** The durable Turso outbox still provides reconnect
recovery either way. Typing/recording/presence relays also cross instances
through the bus once Redis is present.

### emitEvent — call AFTER the DB write

```ts
await emitEvent({
  type: "chat.message.created",
  channel: `chat:${chatRoomId}`,
  resourceId: messageId,
  userId: auth.user.userId,
  payload: { message },          // same shape REST/changes return
  durable: true,                 // default true (outbox); false = ephemeral
});
```

Durable events are appended to `realtime_events` with a monotonic `id`
(the event `seq`) and fanned out to this instance's subscribers. Ephemeral
events (typing / recording / presence) are broadcast only — never written to
the database. Emission is fire-and-forget and never breaks the API response.

## Event protocol (JSON)

Client → server:

```jsonc
{ "type": "subscribe",   "channels": ["chat:ROOM_1", "user:USER_1"] }
{ "type": "unsubscribe", "channels": ["chat:ROOM_1"] }
{ "type": "ping" }
{ "type": "sync", "since": 42 }                  // missed-event recovery
{ "type": "relay", "channel": "chat:ROOM_1", "eventType": "chat.typing.started",
  "payload": { } }                               // ephemeral ONLY, allow-listed
```

Server → client:

```jsonc
{ "type": "hello",      "seq": 42 }
{ "type": "subscribed", "channels": [...], "denied": [...] }
{ "type": "event",      "event": { "id": "<uuid>", "seq": 43, "type": "...",
                                   "channel": "...", "ts": "...",
                                   "resourceId": "...", "userId": "...",
                                   "payload": { } } }
{ "type": "pong" } / { "type": "synced", "since": 42 }
{ "type": "error", "code": "...", "message": "..." }
```

### Event types

```
chat.message.created/updated/deleted   chat.typing.started/stopped   chat.recording.started/stopped
chat.message.read                     chat.reaction.updated         chat.presence.updated
post.comment.created/updated/deleted   post.like.updated             notification.created
subscription.count_updated             wallet.updated                purchase.completed
```

`chat.message.updated` / `chat.message.deleted` are emitted by the message
edit/recall endpoints (`/api/chat-rooms/:room/messages/:messageId` — PATCH
edit, DELETE with `scope=me|everyone`). Recall affects every viewer;
delete-for-me affects only the actor's client (clients drop the local row and
cached media only when the event affects them).

### Channels (authorized server-side at subscribe time)

| Channel | Authorized for |
|---|---|
| `user:{userId}` | only that user (private notifications / wallet / own-subscription counts) |
| `chat:{chatRoomId}` | room members only (`getMember`) |
| `post:{postId}` | any authenticated user (comments / like counts; comment room id == post id) |

Clients can never publish durable events. `relay` accepts only the ephemeral
allow-list (typing / recording / presence), the channel must be authorized,
and the acting `userId` is always overwritten server-side.

## Client (`MeetSweet-mobile/MeetSweet-mobile/services/realtime.ts`)

Singleton `realtime` client: authenticated connect (`?token=`, refreshed on
close code 4401), channel subscribe/unsubscribe with server ack, heartbeat
ping (25s), exponential-backoff reconnect (1s → 30s cap), resubscribe +
missed-event recovery (`sync` with the last seen outbox `seq`), and idempotent
delivery (dedup by event `id`). Screens:

- **AuthContext** — connects/disconnects the socket with the auth session.
- **Chat screen** — subscribes `chat:{room}`; messages/typing/recording/read/
  reactions/presence/edit/delete arrive instantly; the 10s changes poll is the
  fallback and only fires while the socket is unavailable. Typing/recording/
  presence are relayed over the socket (HTTP endpoint as fallback for typing).
- **useComments** (MsCommentsSheet) — subscribes `post:{commentRoomId}`; new/
  edited/deleted comments + counts propagate instantly; 10s poll is fallback.
- **Post screen** (`app/content/[id]`) — live like counts + comment counts.
- **MsPostCard** (all feeds) — subscribes `post:{id}` while mounted; other
  users' likes update the count in place. Subscriptions are **batched** into
  one frame per tick.
- **NotificationsContext** — subscribes `user:{me}`; badge updates on
  `notification.created`, wallet refresh on `wallet.updated`; 30s poll fallback.
- **Creator profile** — own-profile subscriber counts update on
  `subscription.count_updated`.

Client details: subscribe/unsubscribe requests are batched (one frame per
tick) and sent only after the server's `hello` (auth complete); the server
also buffers pre-auth frames so a first frame is never dropped. Events are
deduped by server event id; typing relays are throttled (server + client).

## Deployment notes (Vercel)

- WebSockets require **Fluid compute** — enabled project-wide in `vercel.json`
  (`"fluid": true`). Default for new projects since April 23, 2025.
- The endpoint is `app/api/realtime/route.ts` using
  `experimental_upgradeWebSocket` from `@vercel/functions` (Next.js has no
  native upgrade API). Runtime `nodejs`, `dynamic = "force-dynamic"`,
  `maxDuration = 300` (Hobby).
- **Connections are pinned to one Function instance** and closed at max
  duration. Durable events go through the Turso outbox so a reconnecting
  client — possibly onto a different instance — recovers what it missed via
  `sync`. Ephemeral events (typing/recording/presence) only reach connections
  co-located on the emitting instance; for multi-instance ephemeral fan-out,
  plug a Redis pub/sub into `emitEvent` (cross-instance coordination is what
  Vercel recommends an external store for). At this app's scale a single
  instance is the norm; the fallback polls keep correctness regardless.
- `realtime_events` self-initializes with `CREATE TABLE IF NOT EXISTS` — no
  manual production migration required (schema declared in `lib/db/schema.ts`).

## Test checklist

**Chat**
- [ ] Send a message → appears instantly on the recipient's open chat (no poll wait)
- [ ] Sender's own message: optimistic bubble → confirmed, no duplicate when the socket echo races the HTTP confirmation
- [ ] Typing indicator appears/disappears immediately (not via poll); clears when the sender's message arrives
- [ ] Recording state ("Recording voice note...") shows immediately while the other user records
- [ ] Read receipts flip to read instantly (no leave/reopen)
- [ ] Reactions update instantly on both sides
- [ ] Edit a message → the other participant's bubble updates instantly
- [ ] Recall a message (delete for everyone) → disappears instantly for both; delete-for-me only hides it for the actor
- [ ] Reopen the chat after killing the app → messages render from local cache instantly (SQLite), new ones sync in background

**Comments**
- [ ] New comment appears instantly for everyone viewing the post (no refresh, no poll wait)
- [ ] Comment count updates instantly
- [ ] Deleted comment disappears instantly
- [ ] Edited comment body updates instantly
- [ ] Reply count bumps instantly

**Likes**
- [ ] Like/unlike updates the count instantly for active viewers of the post

**Notifications**
- [ ] Notification badge updates instantly on the target device (no 30s poll wait)
- [ ] Wallet balance refresh triggered after confirmed wallet events

**Subscriptions / purchases**
- [ ] Creator's own profile subscriber count updates live after a confirmed subscription
- [ ] Album purchase → buyer wallet + purchase state update on confirmed DB state only

**Connectivity**
- [ ] Airplane-mode disconnect → client reconnects with backoff on recovery
- [ ] After reconnect, channels are re-subscribed and missed durable events are replayed (`sync`)
- [ ] Heartbeat keeps idle connections alive; dead ones are replaced

**Cross-instance (multi-device on separate instances)**
- [ ] With `REDIS_URL` set: a message sent on device A reaches device B even when their connections landed on different Function instances
- [ ] Typing/presence relays cross instances once Redis is configured
- [ ] Without `REDIS_URL`: single-instance realtime still works; reconnect `sync` recovers durable events

**Security**
- [ ] Subscribing to another user's `user:{id}` channel is denied
- [ ] Subscribing to a chat room you are not a member of is denied
- [ ] Relay of a durable event type (e.g. `chat.message.created`) is rejected
- [ ] A token from a deleted/deactivated account is rejected at connect (4401)

## Messaging architecture — canonical contract (final pass, 2026-08-22)

The messaging system is local-first with realtime sync. The layers and their
responsibilities:

```
Turso (durable truth)  ←  Next.js API validates + persists
        ▲
        │ emitEvent after every DB write (durable) / relay (ephemeral)
WebSocket (realtime delivery)  →  chat:{roomId} channel, authorized server-side
        │
SQLite on device (instant render layer)  ←  WS events + HTTP confirmations write here
        │
Chat UI (React state mirrors SQLite; optimistic bubbles keyed by temp id)
```

**One message contract everywhere.** Mobile `types/chat-message.ts` (`MsMessage`)
is the canonical client model; the server's `buildMessage` (lib/services/chat-rooms.ts)
returns the same fields (snake + camel). `toMsMessage` normalizes any server
payload — HTTP response, WS event, SQLite row — into the same shape. The same
message means the same thing in the UI, SQLite, the WS payload, and the API.

**Explicit message types** (never inferred from a URL/extension):
`text | image | gif | sticker | video | audio | voice | file | system`.
`gif`/`sticker` are first-class media types — a GIF is `messageType: 'gif'`
with `mime_type: image/gif`; it is NEVER degraded to `image`. Stickers are
`messageType: 'sticker'` (sent with `media_type: 'sticker'` + emoji body) and
render as floating emoji — they are NOT routed through the text pipeline.

**Ordering is deterministic.** Server: `ORDER BY created_at (DESC|ASC), id
(DESC|ASC)` — the id tie-break keeps same-millisecond messages stable across
pagination and the changes feed. Client: every merge re-sorts the list by
`createdAt` desc (`byNewestFirst`) so an inverted list never shows a message in
the wrong position, regardless of WS delivery order or clock skew. Optimistic
messages keep their list key through confirmation (`finalizeTemp`: `_id` stays
the temp id, `msServerId` carries the real id) — the bubble never remounts or
jumps.

**Client message id / dedup.** Every optimistic message gets a unique temp id
(`temp_<ts>`); the server id becomes `msServerId` on confirmation. Dedup keys on
`realMessageId()` (server id when known), preferring the confirmed copy — so a
WS echo racing the HTTP confirmation can never produce a visible duplicate.
(Same event id dedup also exists at the socket layer in `services/realtime.ts`.)

**Persistence rule.** The HTTP send response is the authoritative confirmation:
every send path (text, voice, image/video/gif/document, sticker) writes the
confirmed message into SQLite immediately (`cacheMessages`). Local durability
never depends on the WS echo or the changes-poll — a missed echo (socket down,
reconnect gap) can no longer make a sent message vanish on re-entry. Media
files are mirrored into the room's persistent document directory
(`chat-media/<room>/<messageId>.<ext>`) keyed by the STABLE message id, never
by a signed URL.

**Lifecycle / status.** `pending` (optimistic) → `sent` (server-confirmed,
`finalizeTemp`) → `received`/read (only when the backend reports the other
participant read past it) — and `failed` (`pending: false, sent: false`) on
error, with a retry affordance. The UI never infers state from whether a URL
exists.

**GIF provider (Giphy).** The GIF button opens a REAL Giphy search picker
(`components/chat/MsGifPicker` + `services/gifs.ts`). The Giphy API key lives
ONLY on the server (`GIPHY_API_KEY` env var — never in the mobile bundle): the
client calls the authenticated proxy `GET /api/gifs?q=…` (search/trending,
`app/api/gifs/route.ts`), which calls Giphy server-side and returns
`{ id, title, previewUrl (fixed_width .gif), gifUrl (original .gif), width,
height }`. The selected GIF is downloaded to cache, uploaded as `image/gif`,
stored as `.gif`, and rendered ANIMATED via expo-image — never degraded to a
static image. (Giphy's original/fixed_width are animated .gif URLs; Expo
converts GIFs to static on Android only when re-encoding below quality 1.0,
which this pipeline never does.)

**Android keyboard GIF/sticker input — researched and documented.** Android
keyboards (Gboard) deliver GIF/sticker content through `commitContent` /
ContentProvider URIs. React Native's core `TextInput` does NOT expose this in
Expo Go, and there is no Expo API for it — supporting it requires a native
build (expo-dev-client) with a custom native module (e.g. a
`ReactTextInput` `commitContent` bridge). This is a platform limitation, not a
bug in the app: the in-app Giphy picker is the supported GIF entry point (and
the composer has a dedicated sticker button + emoji sticker sheet), so no JS
workaround is attempted inside Expo Go.
