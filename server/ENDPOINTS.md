# MeetSweet API — Endpoint Reference

**Base URL:** `https://<your-domain>/api`  
**Auth header:** `Authorization: Bearer <access_token>`  
**Content-Type:** `application/json` (unless file upload)  
**Response envelope:**
```json
{ "ok": true, "data": {...}, "message": "..." }
{ "ok": false, "error": "...", "code": "ERROR_CODE" }
```

---

## Authentication

### POST /api/auth/register
Register a new user account. Sends email verification code.

**Auth required:** No  
**Request body:**
```json
{ "full_name": "string", "username": "string", "email": "string", "password": "string (min 8)", "phone": "string?" }
```
**Response:** `{ user_id: "uuid" }`  
**Errors:** 409 email/username conflict  
**DB tables:** users, profiles, wallets, verification_codes  
**Screen:** Register screen

---

### POST /api/auth/login
Login with email and password.

**Auth required:** No  
**Request body:**
```json
{ "email": "string", "password": "string", "device_id": "string?" }
```
**Response:** `{ access_token, refresh_token, user: { id, full_name, username, email, role, is_creator, avatar_url } }`  
**Errors:** 401 invalid credentials, 403 email not verified / account deactivated  
**DB tables:** users, profiles, refresh_tokens, login_history  
**Screen:** Login screen

---

### POST /api/auth/logout
Logout current device (revokes refresh token).

**Auth required:** Yes  
**Request body:** `{ "refresh_token": "string?" }`  
**Response:** null  
**DB tables:** refresh_tokens  
**Screen:** Settings / Profile

---

### POST /api/auth/logout-all
Logout from all devices (revokes all refresh tokens).

**Auth required:** Yes  
**Request body:** none  
**Response:** null  
**DB tables:** refresh_tokens  
**Screen:** Security settings

---

### POST /api/auth/refresh
Rotate access and refresh tokens.

**Auth required:** No (uses refresh token in body)  
**Request body:** `{ "refresh_token": "string" }`  
**Response:** `{ access_token, refresh_token }`  
**DB tables:** refresh_tokens, users  
**Screen:** Background token refresh

---

### POST /api/auth/verify-email
Verify email address with 6-digit code.

**Auth required:** No  
**Request body:** `{ "email": "string", "code": "string" }`  
**Response:** null  
**DB tables:** users, verification_codes  
**Screen:** Email verification screen

---

### POST /api/auth/resend-verification
Resend email verification code.

**Auth required:** No  
**Request body:** `{ "email": "string" }`  
**Response:** null  
**DB tables:** verification_codes  
**Screen:** Email verification screen

---

### POST /api/auth/forgot-password
Request a password reset code via email.

**Auth required:** No  
**Request body:** `{ "email": "string" }`  
**Response:** null  
**DB tables:** verification_codes  
**Screen:** Forgot password screen

---

### POST /api/auth/reset-password
Reset password using code from email.

**Auth required:** No  
**Request body:** `{ "email": "string", "code": "string", "password": "string" }`  
**Response:** null  
**DB tables:** users, verification_codes  
**Screen:** Reset password screen

---

### POST /api/auth/update-password
Change password (authenticated).

**Auth required:** Yes  
**Request body:** `{ "current_password": "string", "new_password": "string" }`  
**Response:** null  
**DB tables:** users  
**Screen:** Change password screen

---

### POST /api/auth/update-email
Request email address change (sends verification to new email).

**Auth required:** Yes  
**Request body:** `{ "email": "string", "password": "string" }`  
**Response:** null  
**DB tables:** verification_codes  
**Screen:** Change email screen

---

### GET /api/auth/username-availability
Check if a username is available.

**Auth required:** No  
**Query params:** `username=string`  
**Response:** `{ available: boolean }`  
**DB tables:** users  
**Screen:** Register / edit profile

---

### DELETE /api/auth/delete-account
Soft-delete authenticated user account.

**Auth required:** Yes  
**Response:** null  
**DB tables:** users  
**Screen:** Account settings

---

### GET /api/auth/sessions
List active sessions for the authenticated user.

**Auth required:** Yes  
**Response:** `{ sessions: [{ id, device_id, created_at, expires_at }] }`  
**DB tables:** refresh_tokens  
**Screen:** Active sessions screen

---

### GET /api/auth/history
Login history for authenticated user.

**Auth required:** Yes  
**Query params:** `page`, `limit`  
**Response:** `{ history: [{ id, ip_address, user_agent, device_id, status, created_at }], page, limit }`  
**DB tables:** login_history  
**Screen:** Login history screen

---

### PATCH /api/auth/biometric
Update biometric login preference.

**Auth required:** Yes  
**Request body:** `{ "biometric_login": boolean }`  
**Response:** `{ biometric_login: boolean }`  
**DB tables:** user_settings  
**Screen:** Security settings

---

## User Settings

### GET /api/settings
Get all user settings (returns defaults if not yet saved).

**Auth required:** Yes  
**Response:** `{ theme, language, notif_*, show_*, private_account, ... }`  
**DB tables:** user_settings  
**Screen:** Settings screen

---

### PATCH /api/settings
Update one or more settings.

**Auth required:** Yes  
**Request body:** Any subset of:
```json
{
  "theme": "light|dark|system",
  "language": "en",
  "notif_likes": true,
  "notif_comments": true,
  "notif_follows": true,
  "notif_messages": true,
  "notif_subscriptions": true,
  "private_account": false,
  "show_online_status": true,
  "show_read_receipts": true,
  "typing_indicator": true,
  "sensitive_content": false,
  "data_saver": false,
  "autoplay_media": true,
  "biometric_login": false
}
```
**Response:** Updated settings object  
**DB tables:** user_settings  
**Screen:** Settings screens

---

## User Profile

### GET /api/users/me
Get the authenticated user's full profile.

**Auth required:** Yes  
**Response:** `{ id, full_name, username, email, phone, is_creator, is_verified, role, display_name, bio, avatar_url (signed), banner_url (signed), website, location, subscription_price, is_verified_creator, created_at }`  
**DB tables:** users, profiles  
**Screen:** Profile / home screen

---

### PATCH /api/users/me
Update authenticated user's name, bio, website, location.

**Auth required:** Yes  
**Request body:** `{ name?, bio?, website?, location? }`  
**Response:** `{ user: {...} }`  
**DB tables:** users, profiles  
**Screen:** Edit profile

---

### GET /api/users/:username
Get a user's public profile by username.

**Auth required:** Optional (adds `isFollowing` if authed)  
**Response:** `{ user: { id, name, username, bio, avatar_url, banner_url, website, is_verified, is_creator, follower_count, following_count, post_count, created_at }, isFollowing }`  
**DB tables:** users, profiles, follows, posts  
**Screen:** Public profile screen

---

### GET /api/users/:username/posts
Get a user's posts.

**Auth required:** Optional (owner sees drafts)  
**Query params:** `page`, `limit`, `status=published|archived`  
**Response:** `{ posts: [...], page, limit }`  
**DB tables:** posts, users, profiles  
**Screen:** Profile posts tab

---

### POST /api/users/:username/follow
Follow a user.

**Auth required:** Yes  
**Response:** `{ following: true }`  
**DB tables:** follows  
**Screen:** Profile screen

---

### DELETE /api/users/:username/follow
Unfollow a user.

**Auth required:** Yes  
**Response:** `{ following: false }`  
**DB tables:** follows  
**Screen:** Profile screen

---

### POST /api/users/:username/report
Report a user.

**Auth required:** Yes  
**Request body:** `{ "reason": "string", "description": "string?" }`  
**Response:** null  
**DB tables:** reports  
**Screen:** Profile screen (report action)

---

### POST /api/users/block
Block a user.

**Auth required:** Yes  
**Request body:** `{ "user_id": "uuid" }`  
**Response:** null  
**DB tables:** blocked_users  
**Screen:** Profile / message screen

---

### DELETE /api/users/block
Unblock a user.

**Auth required:** Yes  
**Request body:** `{ "user_id": "uuid" }`  
**Response:** null  
**DB tables:** blocked_users  
**Screen:** Blocked users list

---

### POST /api/users/mute
Mute a user.

**Auth required:** Yes  
**Request body:** `{ "user_id": "uuid" }`  
**Response:** null  
**DB tables:** muted_users  
**Screen:** Profile / context menu

---

### DELETE /api/users/mute
Unmute a user.

**Auth required:** Yes  
**Request body:** `{ "user_id": "uuid" }`  
**Response:** null  
**DB tables:** muted_users  
**Screen:** Muted users list

---

### GET /api/users/search
Search users by name or username.

**Auth required:** Yes  
**Query params:** `q=string (min 2)`  
**Response:** `{ users: [{ id, name, username, avatarUrl (signed), isVerified }] }`  
**DB tables:** users, profiles  
**Screen:** Search / new conversation

---

## Profiles

### GET /api/profiles/:userId
Get a user's profile by user ID.

**Auth required:** No  
**Response:** `{ id, username, full_name, is_creator, role, display_name, bio, avatar_url (signed), banner_url (signed), website, location, is_verified_creator, subscription_price, created_at }`  
**DB tables:** users, profiles  
**Screen:** Profile screen

---

### PATCH /api/profiles/:userId
Update profile (own profile only).

**Auth required:** Yes (must match userId)  
**Request body:** `{ username?, display_name?, bio?, website?, location? }`  
**Response:** null  
**DB tables:** users, profiles  
**Screen:** Edit profile

---

### PUT /api/profiles/:userId/avatar
Upload profile picture. Send raw image bytes as request body with `Content-Type: image/*`.

**Auth required:** Yes (must match userId)  
**Request body:** Raw image bytes  
**Content-Type:** `image/jpeg`, `image/png`, `image/webp`  
**Max size:** 10 MB  
**Response:** `{ avatar_url: "signed-url" }`  
**DB tables:** profiles  
**R2:** Stores at `avatars/{userId}/{uuid}.ext`  
**Screen:** Edit profile — avatar upload

---

### DELETE /api/profiles/:userId/avatar
Remove profile picture.

**Auth required:** Yes (must match userId)  
**Response:** null  
**DB tables:** profiles  
**R2:** Deletes object from R2  
**Screen:** Edit profile

---

### PUT /api/profiles/:userId/banner
Upload cover/banner image.

**Auth required:** Yes (must match userId)  
**Request body:** Raw image bytes  
**Content-Type:** `image/jpeg`, `image/png`, `image/webp`  
**Max size:** 10 MB  
**Response:** `{ banner_url: "signed-url" }`  
**DB tables:** profiles  
**R2:** Stores at `banners/{userId}/{uuid}.ext`  
**Screen:** Edit profile — cover upload

---

### DELETE /api/profiles/:userId/banner
Remove cover/banner image.

**Auth required:** Yes (must match userId)  
**Response:** null  
**DB tables:** profiles  
**R2:** Deletes object from R2  
**Screen:** Edit profile

---

### GET /api/profiles/:userId/creator-settings
Get creator settings (own only).

**Auth required:** Yes (must match userId)  
**Response:** `{ subscription_price, allow_dms, allow_comments, welcome_message, verification_status }`  
**DB tables:** creator_settings  
**Screen:** Creator settings screen

---

### PUT /api/profiles/:userId/creator-settings
Update creator settings.

**Auth required:** Yes (must match userId, must be creator)  
**Request body:** `{ subscription_price?, allow_dms?, allow_comments?, welcome_message? }`  
**Response:** null  
**DB tables:** creator_settings  
**Screen:** Creator settings screen

---

## Posts

### GET /api/posts
Get post feed.

**Auth required:** Optional  
**Query params:** `page`, `limit`, `bookmarked=true` (auth required for bookmarked)  
**Response:** `{ posts: [...], page, limit }`  
**DB tables:** posts, users, profiles, saved_posts  
**Screen:** Home feed, bookmarks

---

### POST /api/posts
Create a post (draft or published).

**Auth required:** Yes  
**Request body:**
```json
{
  "caption": "string?",
  "visibility": "public|subscribers|private",
  "status": "draft|published",
  "media_ids": ["uuid"],
  "preview_duration": 30,
  "expires_at": "ISO date?"
}
```
**Response:** `{ id: "uuid" }`  
**DB tables:** posts, media  
**Screen:** Create post screen

---

### GET /api/posts/:postId
Get a single post. Records a view if authenticated.

**Auth required:** Optional  
**Response:** `{ ...post, creator_avatar (signed), liked_by_me, bookmarked_by_me, purchased_by_me, media: [{url (signed), type, ...}] }`  
**DB tables:** posts, users, profiles, media, post_likes, saved_posts, content_purchases, post_views  
**Screen:** Post detail screen

---

### PATCH /api/posts/:postId
Edit a post (creator only).

**Auth required:** Yes  
**Request body:** `{ caption?, visibility?, preview_duration?, expires_at? }`  
**Response:** null  
**DB tables:** posts  
**Screen:** Edit post screen

---

### DELETE /api/posts/:postId
Soft-delete a post.

**Auth required:** Yes (creator or admin)  
**Response:** null  
**DB tables:** posts  
**Screen:** Post options

---

### POST /api/posts/:postId/publish
Publish a draft post.

**Auth required:** Yes (creator)  
**Response:** null  
**DB tables:** posts  
**Screen:** Create/edit post

---

### POST /api/posts/:postId/restore
Restore a deleted post to draft.

**Auth required:** Yes (creator)  
**Response:** null  
**DB tables:** posts  
**Screen:** Archive management

---

### POST /api/posts/:postId/like
Like a post.

**Auth required:** Yes  
**Response:** null  
**DB tables:** posts, post_likes  
**Screen:** Feed / post detail

---

### DELETE /api/posts/:postId/like
Unlike a post.

**Auth required:** Yes  
**Response:** null  
**DB tables:** posts, post_likes  
**Screen:** Feed / post detail

---

### POST /api/posts/:postId/save
Bookmark/save a post.

**Auth required:** Yes  
**Response:** null  
**DB tables:** posts, saved_posts  
**Screen:** Feed / post detail

---

### DELETE /api/posts/:postId/save
Remove bookmark.

**Auth required:** Yes  
**Response:** null  
**DB tables:** posts, saved_posts  
**Screen:** Feed / post detail

---

### POST /api/posts/:postId/bookmark
Alias for `/save` (same behavior).

**Auth required:** Yes  
**Screen:** Feed / post detail

---

### DELETE /api/posts/:postId/bookmark
Alias for DELETE `/save`.

---

### POST /api/posts/:postId/pin
Pin a post (creator only).

**Auth required:** Yes (creator)  
**Response:** null  
**DB tables:** posts  
**Screen:** Post options

---

### DELETE /api/posts/:postId/pin
Unpin a post.

**Auth required:** Yes (creator)  
**Response:** null  
**DB tables:** posts  
**Screen:** Post options

---

### POST /api/posts/:postId/archive
Move post to archive.

**Auth required:** Yes (creator)  
**Response:** null  
**DB tables:** posts, archives  
**Screen:** Post options

---

### DELETE /api/posts/:postId/archive
Restore from archive.

**Auth required:** Yes (creator)  
**Response:** null  
**DB tables:** posts  
**Screen:** Archive screen

---

### POST /api/posts/:postId/hide
Hide a post from feed (for current user).

**Auth required:** Yes  
**Response:** null  
**DB tables:** hidden_posts  
**Screen:** Feed (hide post action)

---

### POST /api/posts/:postId/report
Report a post.

**Auth required:** Yes  
**Request body:** `{ "reason": "string", "description": "string?" }`  
**Response:** null  
**DB tables:** reports  
**Screen:** Post options (report)

---

### POST /api/posts/:postId/lock
Lock post as premium content (creator only).

**Auth required:** Yes (creator)  
**Request body:** `{ "unlock_price": number, "visibility": "subscribers|private" }`  
**Response:** null  
**DB tables:** posts  
**Screen:** Post options — monetize

---

### POST /api/posts/:postId/unlock
Remove premium lock (creator only).

**Auth required:** Yes (creator)  
**Response:** null  
**DB tables:** posts  
**Screen:** Post options

---

### GET /api/posts/:postId/purchase
Check purchase eligibility and status.

**Auth required:** Yes  
**Response:** `{ unlock_price, is_owner, is_purchased, purchased_at, can_afford, wallet_balance }`  
**DB tables:** posts, content_purchases, wallets  
**Screen:** Locked content screen

---

### POST /api/posts/:postId/purchase
Purchase access to locked content using wallet balance.

**Auth required:** Yes  
**Response:** `{ id: "purchase_uuid" }`  
**Errors:** 402 insufficient balance, 400 already purchased / not purchasable  
**DB tables:** content_purchases, wallets, transactions  
**Screen:** Locked content — unlock screen

---

## Comments

### GET /api/posts/:postId/comments
Get comments for a post.

**Auth required:** No  
**Query params:** `page`, `limit`  
**Response:** `{ comments: [{ id, body, is_pinned, like_count, reply_count, author_username, author_avatar (signed), ... }], page, limit }`  
**DB tables:** comments, users, profiles  
**Screen:** Post comments screen

---

### POST /api/posts/:postId/comments
Create a comment.

**Auth required:** Yes  
**Request body:** `{ "body": "string" }`  
**Response:** `{ id: "uuid" }`  
**DB tables:** comments, posts  
**Screen:** Post comments screen

---

### PATCH /api/comments/:commentId
Edit a comment (author only).

**Auth required:** Yes  
**Request body:** `{ "body": "string" }`  
**Response:** null  
**DB tables:** comments  
**Screen:** Comment options

---

### DELETE /api/comments/:commentId
Delete a comment (author or admin).

**Auth required:** Yes  
**Response:** null  
**DB tables:** comments, posts  
**Screen:** Comment options

---

### POST /api/comments/:commentId/like
Like a comment.

**Auth required:** Yes  
**Response:** null  
**DB tables:** comments, comment_likes  
**Screen:** Comments screen

---

### DELETE /api/comments/:commentId/like
Unlike a comment.

**Auth required:** Yes  
**Response:** null  
**DB tables:** comments, comment_likes  
**Screen:** Comments screen

---

### POST /api/comments/:commentId/pin
Pin a comment (post creator only).

**Auth required:** Yes (post creator)  
**Response:** null  
**DB tables:** comments  
**Screen:** Comment options (creator)

---

### DELETE /api/comments/:commentId/pin
Unpin a comment.

**Auth required:** Yes (post creator)  
**Response:** null  
**DB tables:** comments  
**Screen:** Comment options (creator)

---

### POST /api/comments/:commentId/report
Report a comment.

**Auth required:** Yes  
**Request body:** `{ "reason": "string", "description": "string?" }`  
**Response:** null  
**DB tables:** reports  
**Screen:** Comment options

---

### GET /api/comments/:commentId/replies
Get replies to a comment.

**Auth required:** No  
**Query params:** `page`, `limit`  
**Response:** `{ replies: [...], page, limit }`  
**DB tables:** comment_replies, users, profiles  
**Screen:** Comment replies screen

---

### POST /api/comments/:commentId/replies
Post a reply to a comment.

**Auth required:** Yes  
**Request body:** `{ "body": "string", "mention_id": "uuid?" }`  
**Response:** `{ id: "uuid" }`  
**DB tables:** comment_replies, comments  
**Screen:** Comment replies screen

---

## Explore

### GET /api/explore
Get trending posts, trending creators, and suggested creators.

**Auth required:** Optional (suggested creators personalized if authed)  
**Response:**
```json
{
  "trending_posts": [...],
  "trending_creators": [...],
  "suggested_creators": [...]
}
```
**DB tables:** posts, users, profiles, follows  
**Screen:** Explore / Discover screen

---

## Search

### GET /api/search
Search across users, creators, and posts.

**Auth required:** Optional (saves recent search if authed)  
**Query params:** `q=string`, `type=all|users|creators|posts`, `page`, `limit`  
**Response:** `{ users?: [...], posts?: [...] }`  
**DB tables:** users, profiles, posts, recent_searches  
**Screen:** Search screen

---

### GET /api/search/recent
Get recent searches for authenticated user.

**Auth required:** Yes  
**Response:** `{ searches: [{ id, query, created_at }] }`  
**DB tables:** recent_searches  
**Screen:** Search screen

---

### DELETE /api/search/recent
Clear all recent searches.

**Auth required:** Yes  
**Response:** null  
**DB tables:** recent_searches  
**Screen:** Search screen

---

## Categories

### GET /api/categories
Get all content categories (lazy-seeded on first call).

**Auth required:** No  
**Response:** `{ categories: [{ id, name, slug, postCount }] }`  
**DB tables:** categories  
**Screen:** Explore / category browser

---

## Messaging

### GET /api/messages/conversations
List all conversations for the authenticated user.

**Auth required:** Yes  
**Response:** Array of conversation objects with membership metadata  
**DB tables:** conversations, conversation_members  
**Screen:** Messages screen

---

### POST /api/messages/conversations
Create a new conversation.

**Auth required:** Yes  
**Request body:** `{ "participant_ids": ["uuid"], "type": "direct|group", "name": "string?" }`  
**Response:** `{ id: "uuid" }`  
**DB tables:** conversations, conversation_members  
**Screen:** New conversation screen

---

### GET /api/messages/conversations/:conversationId
Get conversation detail with members.

**Auth required:** Yes (must be member)  
**Response:** `{ ...conversation, members: [...], membership: {...} }`  
**DB tables:** conversations, conversation_members  
**Screen:** Chat screen

---

### DELETE /api/messages/conversations/:conversationId
Leave a conversation.

**Auth required:** Yes (must be member)  
**Response:** null  
**DB tables:** conversation_members  
**Screen:** Chat settings

---

### GET /api/messages/conversations/:conversationId/messages
Get paginated messages (cursor-based).

**Auth required:** Yes (must be member)  
**Query params:** `cursor=ISO-timestamp`, `limit`  
**Response:** `{ messages: [...], next_cursor }`  
**DB tables:** messages, users, profiles  
**Screen:** Chat screen

---

### POST /api/messages/conversations/:conversationId/messages
Send a message.

**Auth required:** Yes (must be member)  
**Request body:** `{ "type": "text|image|video|audio|file", "body": "string?", "media_url": "string?", "media_blob_path": "string?", "reply_to_id": "uuid?" }`  
**Response:** `{ id: "uuid" }`  
**DB tables:** messages, conversations  
**Screen:** Chat screen

---

### POST /api/messages/conversations/:conversationId/read
Mark conversation as read.

**Auth required:** Yes (must be member)  
**Response:** null  
**DB tables:** conversation_members  
**Screen:** Chat screen (on open/scroll)

---

### POST /api/messages/conversations/:conversationId/mute
Mute a conversation.

**Auth required:** Yes  
**Response:** null  
**DB tables:** conversation_members  
**Screen:** Chat options

---

### DELETE /api/messages/conversations/:conversationId/mute
Unmute a conversation.

**Auth required:** Yes  
**Response:** null  
**DB tables:** conversation_members  
**Screen:** Chat options

---

### POST /api/messages/conversations/:conversationId/pin
Pin a conversation.

**Auth required:** Yes  
**Response:** null  
**DB tables:** conversation_members  
**Screen:** Messages screen

---

### DELETE /api/messages/conversations/:conversationId/pin
Unpin a conversation.

**Auth required:** Yes  
**Response:** null  
**DB tables:** conversation_members  
**Screen:** Messages screen

---

### GET /api/messages/conversations/:conversationId/search
Search messages within a conversation.

**Auth required:** Yes (must be member)  
**Query params:** `q=string (min 2)`  
**Response:** `{ messages: [...], query }`  
**DB tables:** messages, users, profiles  
**Screen:** Chat search

---

### GET /api/messages/:messageId
Get a single message.

**Auth required:** Yes  
**Response:** Full message object  
**DB tables:** messages  
**Screen:** Message context

---

### PATCH /api/messages/:messageId
Edit a message (sender only).

**Auth required:** Yes (sender)  
**Request body:** `{ "body": "string" }`  
**Response:** null  
**DB tables:** messages  
**Screen:** Chat screen (edit)

---

### DELETE /api/messages/:messageId
Delete a message for me (soft-delete).

**Auth required:** Yes (sender)  
**Response:** null  
**DB tables:** messages  
**Screen:** Chat screen (delete for me)

---

### POST /api/messages/:messageId/recall
Recall (delete for everyone) a message.

**Auth required:** Yes (sender)  
**Response:** null  
**DB tables:** messages  
**Screen:** Chat screen (delete for everyone)

---

### POST /api/messages/:messageId/react
Add a reaction to a message.

**Auth required:** Yes  
**Request body:** `{ "emoji": "string" }`  
**Response:** null  
**DB tables:** messages  
**Screen:** Chat screen (long press)

---

### DELETE /api/messages/:messageId/react
Remove a reaction.

**Auth required:** Yes  
**Request body:** `{ "emoji": "string" }`  
**Response:** null  
**DB tables:** messages  
**Screen:** Chat screen

---

### POST /api/messages/:messageId/pin
Pin a message in a conversation (member required).

**Auth required:** Yes (conversation member)  
**Response:** null  
**DB tables:** messages  
**Screen:** Chat screen (pin message)

---

### DELETE /api/messages/:messageId/pin
Unpin a message.

**Auth required:** Yes (conversation member)  
**Response:** null  
**DB tables:** messages  
**Screen:** Chat screen

---

### POST /api/messages/:messageId/report
Report a message.

**Auth required:** Yes (must be conversation member)  
**Request body:** `{ "reason": "string", "description": "string?" }`  
**Response:** null  
**DB tables:** reports  
**Screen:** Chat screen (report)

---

## Notifications

### GET /api/notifications
Get notifications with unread count.

**Auth required:** Yes  
**Response:** `{ notifications: [...], unread_count: number }`  
**DB tables:** notifications, users, profiles  
**Screen:** Notifications screen

---

### PATCH /api/notifications/:notificationId
Mark a notification as read.

**Auth required:** Yes (owner)  
**Response:** null  
**DB tables:** notifications  
**Screen:** Notifications screen

---

### DELETE /api/notifications/:notificationId
Delete a notification.

**Auth required:** Yes (owner)  
**Response:** null  
**DB tables:** notifications  
**Screen:** Notifications screen

---

### POST /api/notifications/read-all
Mark all notifications as read.

**Auth required:** Yes  
**Response:** null  
**DB tables:** notifications  
**Screen:** Notifications screen

---

## Creator

### GET /api/creator/dashboard
Creator dashboard overview (requires creator role).

**Auth required:** Yes (creator)  
**Response:** `{ wallet_balance, active_subscribers, total_posts, total_revenue, period_stats }`  
**DB tables:** wallets, subscriptions, posts, creator_statistics, transactions  
**Screen:** Creator dashboard

---

### GET /api/creator/analytics
Monthly analytics stats.

**Auth required:** Yes (creator)  
**Response:** `{ period_stats, active_subscribers, total_posts }`  
**DB tables:** creator_statistics, subscriptions, posts  
**Screen:** Creator analytics

---

### GET /api/creator/revenue
Revenue history and wallet balance.

**Auth required:** Yes (creator)  
**Query params:** `page`, `limit`  
**Response:** `{ balance, currency, earnings: [...], page, limit }`  
**DB tables:** wallets, transactions  
**Screen:** Creator earnings screen

---

### GET /api/creator/subscribers
List of subscribers with status filter.

**Auth required:** Yes (creator)  
**Query params:** `page`, `limit`, `status=active|cancelled|expired`  
**Response:** `{ subscribers: [...], page, limit }`  
**DB tables:** subscriptions, users, profiles  
**Screen:** Creator subscribers screen

---

### POST /api/creator/become
Activate creator account.

**Auth required:** Yes  
**Response:** null  
**DB tables:** users, creator_settings  
**Screen:** Become creator screen

---

### POST /api/creator/verification
Request creator verification badge.

**Auth required:** Yes (must be creator)  
**Response:** null  
**DB tables:** creator_settings  
**Screen:** Verification request screen

---

### GET /api/creator/withdraw
Get withdrawal history.

**Auth required:** Yes (creator)  
**Response:** `{ withdrawals: [...] }`  
**DB tables:** withdrawals  
**Screen:** Withdrawal history screen

---

### POST /api/creator/withdraw
Submit a withdrawal request.

**Auth required:** Yes (creator)  
**Request body:**
```json
{
  "amount": 5000,
  "bank_code": "044",
  "account_number": "0123456789",
  "account_name": "Jane Doe",
  "note": "string?"
}
```
**Response:** `{ id, reference }`  
**Errors:** 400 insufficient balance, 409 pending withdrawal exists  
**DB tables:** withdrawals, wallets  
**Screen:** Withdrawal request screen

---

## Subscriptions

### GET /api/subscriptions
List the authenticated user's subscriptions.

**Auth required:** Yes  
**Response:** Array of subscriptions with creator info  
**DB tables:** subscriptions, users, profiles  
**Screen:** Subscriptions screen

---

### POST /api/subscriptions
Subscribe to a creator.

**Auth required:** Yes  
**Request body:** `{ "creator_id": "uuid", "transaction_reference": "string?" }`  
**Response:** `{ id: "uuid" }`  
**DB tables:** subscriptions  
**Screen:** Creator profile (subscribe button)

---

### POST /api/subscriptions/:subscriptionId/cancel
Cancel a subscription.

**Auth required:** Yes (subscriber)  
**Response:** null  
**DB tables:** subscriptions  
**Screen:** Subscription management

---

## Wallet & Payments

### GET /api/wallet
Get wallet balance and transaction history.

**Auth required:** Yes  
**Response:** `{ wallet: { balance, currency }, transactions: [...] }`  
**DB tables:** wallets, transactions  
**Screen:** Wallet screen

---

### POST /api/payments/initialize
Initialize a Paystack payment.

**Auth required:** Yes  
**Request body:** `{ "amount": number, "currency": "NGN", "type": "wallet_topup|subscription|purchase", "metadata": {} }`  
**Response:** `{ authorization_url, access_code, reference }`  
**DB tables:** transactions  
**Screen:** Top-up / payment screen

---

### GET /api/payments/verify
Verify a Paystack payment and credit wallet on success.

**Auth required:** Yes  
**Query params:** `reference=string`  
**Response:** `{ status, transaction }`  
**DB tables:** transactions, wallets  
**Screen:** Payment callback screen

---

### POST /api/payments/webhook
Paystack webhook receiver (HMAC-verified). Not called by client.

**Auth required:** No (HMAC signature)  
**DB tables:** transactions, wallets  
**Screen:** N/A

---

## Archive

### GET /api/archive
Get authenticated creator's archived posts.

**Auth required:** Yes  
**Response:** Array of archived post objects  
**DB tables:** archives, posts  
**Screen:** Creator archive screen

---

## Media & Uploads

### POST /api/uploads
Upload any media file (image, video, audio). Stores in R2.

**Auth required:** Yes  
**Request body:** Raw binary file bytes  
**Content-Type:** `image/*`, `video/*`, `audio/*`  
**Max sizes:** 10 MB images, 500 MB video, 50 MB audio  
**Response:** `{ id, url (signed), type, mime_type, size_bytes }`  
**DB tables:** media  
**R2:** Stores at `media/{userId}/{uuid}.ext`  
**Screen:** Post composer, message composer

---

### GET /api/media/signed-url?key=:key
Get a fresh presigned download URL for an R2 object key (use when a URL has expired).

**Auth required:** Yes  
**Query params:** `key=string` (R2 object key, not a URL)  
**Response:** `{ url: "signed-url", expires_in: 604800 }`  
**R2:** Generates presigned URL (7-day expiry)  
**Screen:** Any screen that detects URL expiry

---

### POST /api/media/upload
Alternative upload endpoint (multipart or raw binary, same as /api/uploads).

**Auth required:** Yes  
**Screen:** Post / message composer

---

## Reports (Shared)
All reporting routes share the same request body:
```json
{ "reason": "string (max 200)", "description": "string? (max 1000)" }
```
- `POST /api/posts/:postId/report` — Report a post
- `POST /api/comments/:commentId/report` — Report a comment
- `POST /api/messages/:messageId/report` — Report a message
- `POST /api/users/:username/report` — Report a user

All return `{ ok: true, data: null }` on success. Reports are reviewed by admins.

---

## Admin (Prepared — Not Yet Exposed)
Admin endpoints are reserved for future implementation. The `reports` and `login_history` tables are already in place to support a moderation dashboard.

---

## Notes for Mobile Developers

### Media URLs
All `avatar_url`, `banner_url`, and `media.url` fields in API responses are **pre-signed Cloudflare R2 URLs** valid for **7 days**. When a URL returns 403 (expired), call:
```
GET /api/media/signed-url?key=<blob_path>
```
to get a fresh URL. Store the `blob_path` alongside the URL in your local cache.

### Pagination
Default: `page=1&limit=20`. All paginated endpoints return `{ page, limit }` in the response.

### Cursor-based messaging
`GET /api/messages/conversations/:id/messages` uses cursor pagination. Pass `cursor=<created_at of last message>` to load older messages.

### Token refresh
Access tokens expire in **15 minutes**. Refresh tokens expire in **30 days**.  
Call `POST /api/auth/refresh` with the refresh token to rotate both tokens.
