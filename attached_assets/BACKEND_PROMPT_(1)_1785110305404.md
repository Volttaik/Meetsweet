# MeetSweet Backend — Complete Fix Prompt

You are working on the **MeetSweet Next.js backend**, deployed at `https://meetsweet-server.quizmi.space`.

All responses must use the envelope format:
- Success: `{ "ok": true, "data": { ... } }`
- Error: `{ "ok": false, "error": "message", "code": "CODE" }`

All routes live under `/api/` (Next.js App Router at `app/api/`).

Authentication uses Bearer tokens. Every protected route should return:
`401 { "ok": false, "error": "Missing authorization header", "code": "UNAUTHORIZED" }`
when no valid token is present.

---

## CONFIRMED WORKING — DO NOT TOUCH

These routes already work correctly. Do not modify them:

- `GET /api/healthz`
- `POST /api/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`
- `GET /api/users/me` ← read-only, works fine
- `GET /api/posts` (feed list)
- `POST /api/posts`, `PATCH /api/posts/:id`, `DELETE /api/posts/:id`
- `POST/DELETE /api/posts/:id/like`
- `POST/DELETE /api/posts/:id/bookmark`
- `GET/POST /api/posts/:id/comments`
- `POST /api/posts/:id/report`
- `POST /api/media/upload`
- `GET /api/notifications`
- `POST /api/notifications/read-all`
- `GET /api/wallet`
- `DELETE /api/messages/:id`

---

## FIX 1 — `GET /api/posts/:id` is missing fields

**Current problem:** The single-post detail endpoint returns an incomplete object. It is missing `creator_username`, `creator_display_name`, `creator_avatar`, `creator_is_verified`, `liked_by_me`, and `bookmarked_by_me`. The list endpoint (`GET /api/posts`) returns all of these correctly.

**Required response shape:**

```json
{
  "ok": true,
  "data": {
    "id": "string",
    "creator_id": "string",
    "creator_username": "string",
    "creator_display_name": "string",
    "creator_avatar": "string | null",
    "creator_is_verified": false,
    "caption": "string | null",
    "visibility": "public | subscribers | draft",
    "status": "published",
    "like_count": 0,
    "comment_count": 0,
    "save_count": 0,
    "view_count": 0,
    "is_pinned": false,
    "preview_duration": "number | null",
    "published_at": "ISO string",
    "created_at": "ISO string",
    "updated_at": "ISO string",
    "liked_by_me": false,
    "bookmarked_by_me": false,
    "media": [
      {
        "url": "string",
        "type": "image | video",
        "thumbnail_url": "string | null",
        "duration_secs": "number | null",
        "file_size": "number | null",
        "width": "number | null",
        "height": "number | null"
      }
    ]
  }
}
```

**Fix:** In `app/api/posts/[id]/route.ts`, the GET handler must JOIN the users table to populate creator fields. For authenticated requests, also check the likes and bookmarks tables to set `liked_by_me` and `bookmarked_by_me`. For unauthenticated requests, both default to `false`.

---

## FIX 2 — `PATCH /api/users/me` is missing (update profile)

**Current problem:** `GET /api/users/me` works. `PATCH /api/users/me` and `PUT /api/users/me` both return 405. The route file only has a GET handler. Users cannot save profile changes.

**Add a PATCH handler to `app/api/users/me/route.ts`:**

Request body (all fields optional):
```json
{
  "name": "string",
  "bio": "string | null",
  "avatar_url": "string | null",
  "banner_url": "string | null"
}
```

Response:
```json
{
  "ok": true,
  "data": {
    "user": { "...same shape as GET /users/me response..." }
  }
}
```

Validation:
- 401 if not authenticated
- `name`: minimum 2 characters if provided
- `bio`: maximum 160 characters if provided

---

## FIX 3 — `GET /api/users/:username` is missing (creator profiles)

**Current problem:** Returns 404. `GET /api/users/me` works — only the dynamic `[username]` variant is missing.

**Create `app/api/users/[username]/route.ts`:**

Note: Next.js resolves `/users/me` to the static route before the dynamic `[username]` route, so there is no conflict.

Response:
```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "string",
      "name": "string",
      "username": "string",
      "bio": "string | null",
      "avatar_url": "string | null",
      "banner_url": "string | null",
      "is_verified": false,
      "is_creator": false,
      "follower_count": 0,
      "following_count": 0,
      "post_count": 0,
      "created_at": "ISO string"
    },
    "isFollowing": false
  }
}
```

- 404 `{ "ok": false, "error": "User not found" }` if username does not exist
- `isFollowing`: check the follows table if request is authenticated; default `false`
- No authentication required (public endpoint)

---

## FIX 4 — `POST/DELETE /api/users/:username/follow` is missing (follow/unfollow)

**Create `app/api/users/[username]/follow/route.ts`:**

`POST` — follow the user:
```json
{ "ok": true, "data": { "following": true } }
```

`DELETE` — unfollow the user:
```json
{ "ok": true, "data": { "following": false } }
```

Validation:
- 401 if not authenticated
- 404 if target user not found
- 400 if the authenticated user tries to follow themselves
- Idempotent — following an already-followed user returns 200 (no duplicate row)

---

## FIX 5 — `GET /api/users/search` is missing (user search for messaging)

**Create `app/api/users/search/route.ts`** (static segment — must be placed here, not under `[username]`, so it takes priority over the dynamic route):

Query param: `?q=searchterm`

Response:
```json
{
  "ok": true,
  "data": {
    "users": [
      {
        "id": "string",
        "name": "string",
        "username": "string",
        "avatarUrl": "string | null",
        "isVerified": false
      }
    ]
  }
}
```

Validation:
- 401 if not authenticated
- `q` is required, minimum 2 characters; return 400 if missing/too short
- Case-insensitive partial match on name and username
- Exclude the requesting user from results
- Maximum 20 results

---

## FIX 6 — All messaging routes are missing

`GET /api/conversations`, `POST /api/conversations`, `GET /api/conversations/:id/messages`, `POST /api/conversations/:id/messages`, and `PUT /api/conversations/:id/archive` all return 404. The only message route that exists is `DELETE /api/messages/:id`.

**Create `app/api/conversations/route.ts`:**

`GET /conversations?tab=all|archived` — list user's conversations, newest first:
```json
{
  "ok": true,
  "data": {
    "conversations": [
      {
        "id": "string",
        "lastMessageBody": "string | null",
        "lastMessageAt": "ISO string | null",
        "createdAt": "ISO string",
        "isMuted": false,
        "isArchived": false,
        "unreadCount": 0,
        "otherUser": {
          "id": "string",
          "name": "string",
          "username": "string",
          "avatarUrl": "string | null",
          "isVerified": false
        }
      }
    ]
  }
}
```

`POST /conversations` — create or return existing conversation (idempotent):

Request body: `{ "userId": "string" }`

Response:
```json
{ "ok": true, "data": { "conversationId": "string", "created": true } }
```

- 404 if target user not found
- If a conversation between these two users already exists, return it with `"created": false`

---

**Create `app/api/conversations/[id]/messages/route.ts`:**

`GET /conversations/:id/messages?before=<ISO>` — paginated messages, newest first:
```json
{
  "ok": true,
  "data": {
    "messages": [
      {
        "id": "string",
        "body": "string | null",
        "mediaUrl": "string | null",
        "mediaType": "image | video | null",
        "isDeleted": false,
        "createdAt": "ISO string",
        "sender": {
          "id": "string",
          "name": "string",
          "username": "string",
          "avatarUrl": "string | null"
        },
        "isOwn": true
      }
    ],
    "hasMore": false
  }
}
```

`POST /conversations/:id/messages` — send a message:

Request body: `{ "body": "string", "mediaUrl": "string | null", "mediaType": "image | video | null" }`

At least one of `body` or `mediaUrl` must be present.

Response: `{ "ok": true, "data": { "message": { ...message fields } } }`

---

**Create `app/api/conversations/[id]/archive/route.ts`:**

`PUT /conversations/:id/archive`:

Request body: `{ "archived": true | false }`

Response: `{ "ok": true, "data": {} }`

---

**Validation for all conversation routes:**
- 401 if not authenticated
- 403 if the authenticated user is not a participant in the conversation

---

## FIX 7 — `PUT /api/notifications/:id/read` is missing

`GET /api/notifications` works. `POST /api/notifications/read-all` works. Only marking a single notification as read is missing.

**Create `app/api/notifications/[id]/read/route.ts`:**

`PUT /notifications/:id/read`

Response: `{ "ok": true, "data": {} }`

Validation:
- 401 if not authenticated
- 404 if notification not found
- 403 if notification does not belong to the authenticated user

---

## FIX 8 — `PATCH/DELETE /api/posts/:id/comments/:commentId` is missing (edit and delete comments)

**Create `app/api/posts/[id]/comments/[commentId]/route.ts`:**

`PATCH /posts/:id/comments/:commentId` — edit comment body (owner only):

Request body: `{ "body": "string" }` — required, non-empty

Response:
```json
{
  "ok": true,
  "data": {
    "comment": {
      "id": "string",
      "body": "string",
      "created_at": "ISO string",
      "updated_at": "ISO string",
      "like_count": 0,
      "reply_count": 0,
      "parent_id": "string | null",
      "liked_by_me": false,
      "author": {
        "id": "string",
        "name": "string",
        "username": "string",
        "avatar_url": "string | null"
      }
    }
  }
}
```

`DELETE /posts/:id/comments/:commentId` — delete comment (owner only):

Response: `{ "ok": true, "data": {} }`

Validation:
- 401 if not authenticated
- 403 if authenticated user is not the comment author
- 404 if comment not found

---

## FIX 9 — `POST/DELETE /api/posts/:id/comments/:commentId/like` is missing

**Create `app/api/posts/[id]/comments/[commentId]/like/route.ts`:**

`POST` — like the comment:
```json
{ "ok": true, "data": { "liked": true, "likeCount": 5 } }
```

`DELETE` — unlike the comment:
```json
{ "ok": true, "data": { "liked": false, "likeCount": 4 } }
```

Validation:
- 401 if not authenticated
- 404 if comment not found
- Idempotent — liking twice does not create a duplicate row

---

## FIX 10 — `GET /api/categories` returns empty array (no seed data)

The route exists and returns 200. The database table is empty. Run a one-time seed.

Required response shape:
```json
{
  "ok": true,
  "data": {
    "categories": [
      { "id": "uuid", "name": "Lifestyle", "slug": "lifestyle", "postCount": 0 }
    ]
  }
}
```

Seed these categories (slugs are lowercase, hyphens for spaces):

| name | slug |
|---|---|
| Lifestyle | lifestyle |
| Fashion | fashion |
| Fitness | fitness |
| Photography | photography |
| Gaming | gaming |
| Music | music |
| Dance | dance |
| Comedy | comedy |
| Education | education |
| Art | art |
| Cooking | cooking |
| Travel | travel |
| Technology | technology |
| Models | models |
| Behind the Scenes | behind-the-scenes |
| Luxury | luxury |

---

## FIX 11 — `GET /api/posts?bookmarked=true` ignores the filter

**Current problem:** `GET /posts?bookmarked=true` returns 200 but almost certainly returns all posts instead of only the authenticated user's bookmarked posts.

**Fix:** In `app/api/posts/route.ts`, when `bookmarked=true` is in the query string:
1. Require authentication — return 401 if no valid token
2. Filter the query to only return posts that exist in the bookmarks table for the requesting user
3. Return the same response shape as the normal feed

---

## Summary of files to create or modify

| Action | File |
|---|---|
| Modify | `app/api/posts/[id]/route.ts` — add creator JOIN + liked/bookmarked fields to GET |
| Modify | `app/api/users/me/route.ts` — add PATCH handler |
| Modify | `app/api/posts/route.ts` — apply bookmarked filter |
| Create | `app/api/users/[username]/route.ts` |
| Create | `app/api/users/[username]/follow/route.ts` |
| Create | `app/api/users/search/route.ts` |
| Create | `app/api/conversations/route.ts` |
| Create | `app/api/conversations/[id]/messages/route.ts` |
| Create | `app/api/conversations/[id]/archive/route.ts` |
| Create | `app/api/notifications/[id]/read/route.ts` |
| Create | `app/api/posts/[id]/comments/[commentId]/route.ts` |
| Create | `app/api/posts/[id]/comments/[commentId]/like/route.ts` |
| Seed | Categories table |

---

## Notes for the backend developer

- All these issues were diagnosed by live HTTP probing of `https://meetsweet-server.quizmi.space`. Every 404 is confirmed missing; every 401 is confirmed working.
- The Expo frontend client normalises both camelCase and snake_case field names, but **snake_case is preferred** for database-origin fields (e.g. `creator_username`, `like_count`, `created_at`).
- `DELETE /messages/:id` already exists — the messaging schema is partially there.
- `POST/DELETE /posts/:id/bookmark` already exists and works — the bookmarks table exists.
- Token format is `Authorization: Bearer <jwt>`. The JWT middleware is already working on all existing protected routes.
- The media upload route (`POST /media/upload`) already exists and works. The only upload issue was a MIME type mismatch on the frontend (HEIC), which has already been fixed on the Expo side.
