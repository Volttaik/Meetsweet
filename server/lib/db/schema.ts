import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { DEFAULT_SUBSCRIPTION_PRICE } from "../services/pricing";

const id = () => text("id").primaryKey();
const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);
const updatedAt = () =>
  text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

// ─── Auth / identity ────────────────────────────────────────────────────────

export const users = sqliteTable(
  "users",
  {
    id: id(),
    full_name: text("full_name").notNull(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    password_hash: text("password_hash").notNull(),
    is_verified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
    is_creator: integer("is_creator", { mode: "boolean" }).notNull().default(false),
    is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
    role: text("role", { enum: ["user", "creator", "admin"] }).notNull().default("user"),
    created_at: createdAt(),
    updated_at: updatedAt(),
    deleted_at: text("deleted_at"),
  // ── Two-factor authentication (email-code based) ───────────────────────
  // 2FA uses a 6-digit code emailed to the account owner — no authenticator
  // app, no TOTP secret. The code is stored in verification_codes (type
  // "two_fa") and consumed on login / enable / disable.
  two_fa_enabled: integer("two_fa_enabled", { mode: "boolean" }).notNull().default(false),
  // ── Creator activation ─────────────────────────────────────────────────
  // One-time ₦1,000 activation fee: once paid, creator functionality is
  // permanently unlocked. Server-authoritative — client must never trust a
  // local flag to grant creator access.
  creator_activation_paid: integer("creator_activation_paid", { mode: "boolean" }).notNull().default(false),
  // Last-seen timestamp for online/presence (updated on each authenticated request).
  last_seen_at: text("last_seen_at"),
  // ── Referral ───────────────────────────────────────────────────────────
  // Unique referral code for this user (set on first use; used in links).
  referral_code: text("referral_code"),    // Which user referred this account (null if organic).
    referred_by: text("referred_by"),
    // Stable Google OpenID Connect subject. Nullable so password-only accounts
    // remain unchanged; uniqueness is enforced for linked Google identities.
    google_subject: text("google_subject"),
    google_email: text("google_email"),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_username_idx").on(table.username),
    uniqueIndex("users_referral_code_idx").on(table.referral_code),
    uniqueIndex("users_google_subject_idx").on(table.google_subject).where(sql`${table.google_subject} IS NOT NULL`),
  ],
);

export const profiles = sqliteTable("profiles", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  display_name: text("display_name"),
  bio: text("bio"),
  avatar_url: text("avatar_url"),
  banner_url: text("banner_url"),
  website: text("website"),
  location: text("location"),
  date_of_birth: text("date_of_birth"),
  is_verified_creator: integer("is_verified_creator", { mode: "boolean" }).notNull().default(false),
  category: text("category"),
  subscription_price: real("subscription_price").default(0),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const user_settings = sqliteTable("user_settings", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // ── App settings ──────────────────────────────────────────────────────────
  push_notifications: integer("push_notifications", { mode: "boolean" }).notNull().default(true),
  email_notifications: integer("email_notifications", { mode: "boolean" }).notNull().default(true),
  dark_mode: integer("dark_mode", { mode: "boolean" }).notNull().default(true),
  data_saver: integer("data_saver", { mode: "boolean" }).notNull().default(false),
  autoplay_media: integer("autoplay_media", { mode: "boolean" }).notNull().default(true),
  high_quality_media: integer("high_quality_media", { mode: "boolean" }).notNull().default(true),
  sensitive_content: integer("sensitive_content", { mode: "boolean" }).notNull().default(false),
  language: text("language").notNull().default("English"),
  // ── Privacy settings ──────────────────────────────────────────────────────
  private_account: integer("private_account", { mode: "boolean" }).default(false),
  online_status: integer("online_status", { mode: "boolean" }).default(true),
  activity_status: integer("activity_status", { mode: "boolean" }).default(true),
  typing_indicator: integer("typing_indicator", { mode: "boolean" }).default(true),
  read_receipts: integer("read_receipts", { mode: "boolean" }).default(true),
  allow_dms: integer("allow_dms", { mode: "boolean" }).default(true),
  allow_mentions: integer("allow_mentions", { mode: "boolean" }).default(true),
  allow_tags: integer("allow_tags", { mode: "boolean" }).default(true),
  profile_visibility: text("profile_visibility").default("everyone"),
  message_perm: text("message_perm").default("everyone"),
  search_visible: integer("search_visible", { mode: "boolean" }).default(true),
  birthday_visible: integer("birthday_visible", { mode: "boolean" }).default(false),
  phone_visible: integer("phone_visible", { mode: "boolean" }).default(false),
  sensitive_blur: integer("sensitive_blur", { mode: "boolean" }).default(true),
  qr_discovery: integer("qr_discovery", { mode: "boolean" }).default(true),
  auto_archive: integer("auto_archive", { mode: "boolean" }).default(false),
  // ── Notification preferences ──────────────────────────────────────────────
  notif_messages: integer("notif_messages", { mode: "boolean" }).default(true),
  notif_comments: integer("notif_comments", { mode: "boolean" }).default(true),
  notif_mentions: integer("notif_mentions", { mode: "boolean" }).default(true),
  notif_likes: integer("notif_likes", { mode: "boolean" }).default(true),
  notif_new_subscribers: integer("notif_new_subscribers", { mode: "boolean" }).default(true),
  notif_creator_updates: integer("notif_creator_updates", { mode: "boolean" }).default(true),
  notif_marketing: integer("notif_marketing", { mode: "boolean" }).default(false),
  notif_vibration: integer("notif_vibration", { mode: "boolean" }).default(true),
  notif_sound: integer("notif_sound", { mode: "boolean" }).default(true),
  notif_preview: integer("notif_preview", { mode: "boolean" }).default(true),
  notif_quiet_hours: integer("notif_quiet_hours", { mode: "boolean" }).default(false),
  notif_quiet_start: text("notif_quiet_start").default("22:00"),
  notif_quiet_end: text("notif_quiet_end").default("08:00"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const verification_codes = sqliteTable(
  "verification_codes",
  {
    id: id(),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    type: text("type", { enum: ["email_verify", "password_reset", "phone_verify", "two_fa"] }).notNull(),
    expires_at: text("expires_at").notNull(),
    used_at: text("used_at"),
    created_at: createdAt(),
  },
  (table) => [index("verification_codes_user_type_idx").on(table.user_id, table.type)],
);

export const refresh_tokens = sqliteTable(
  "refresh_tokens",
  {
    id: id(),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token_hash: text("token_hash").notNull(),
    device_id: text("device_id"),
    expires_at: text("expires_at").notNull(),
    revoked_at: text("revoked_at"),
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("refresh_tokens_hash_idx").on(table.token_hash),
    index("refresh_tokens_user_idx").on(table.user_id),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token_hash: text("token_hash").notNull(),
  device_id: text("device_id"),
  ip_address: text("ip_address"),
  user_agent: text("user_agent"),
  expires_at: text("expires_at").notNull(),
  created_at: createdAt(),
});

export const login_history = sqliteTable(
  "login_history",
  {
    id: id(),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ip_address: text("ip_address"),
    user_agent: text("user_agent"),
    device_id: text("device_id"),
    status: text("status", { enum: ["success", "failed"] }).notNull().default("success"),
    created_at: createdAt(),
  },
  (table) => [index("login_history_user_idx").on(table.user_id)],
);

export const devices = sqliteTable("devices", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  push_token: text("push_token"),
  platform: text("platform"),
  device_name: text("device_name"),
  last_seen_at: text("last_seen_at"),
  created_at: createdAt(),
});

// ─── Credential broker ───────────────────────────────────────────────────────

export const credential_grants = sqliteTable(
  "credential_grants",
  {
    id: id(),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token_hash: text("token_hash").notNull(),
    scopes: text("scopes").notNull(),
    expires_at: text("expires_at").notNull(),
    revoked_at: text("revoked_at"),
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("credential_grants_token_idx").on(table.token_hash),
    index("credential_grants_user_idx").on(table.user_id),
    index("credential_grants_expiry_idx").on(table.expires_at),
  ],
);

// ─── Social ─────────────────────────────────────────────────────────────────

export const posts = sqliteTable("posts", {
  id: id(),
  creator_id: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // content_type distinguishes posts / long-form videos / shorts / albums
  content_type: text("content_type", { enum: ["post", "video", "short", "album"] }).notNull().default("post"),
  title: text("title"),
  caption: text("caption"),
  description: text("description"),
  // thumbnail_url: custom thumbnail for video/short posts
  thumbnail_url: text("thumbnail_url"),
  // tier: content access gate — "free" (public), "subscriber", or "subscriber_plus"
  tier: text("tier", { enum: ["free", "subscriber", "subscriber_plus"] }),
  // tags: JSON array of tag strings, e.g. '["comedy","lifestyle"]'
  tags: text("tags"),
  visibility: text("visibility", { enum: ["public", "subscribers", "draft"] }).notNull().default("public"),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  is_pinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  preview_duration: integer("preview_duration"),
  expires_at: text("expires_at"),
  published_at: text("published_at"),
  view_count: integer("view_count").notNull().default(0),
  like_count: integer("like_count").notNull().default(0),
  comment_count: integer("comment_count").notNull().default(0),
  save_count: integer("save_count").notNull().default(0),
  share_count: integer("share_count").notNull().default(0),
  created_at: createdAt(),
  updated_at: updatedAt(),
  deleted_at: text("deleted_at"),
}, (table) => [
  index("posts_content_type_status_idx").on(table.content_type, table.status, table.visibility),
  index("posts_creator_content_type_idx").on(table.creator_id, table.content_type),
]);

export const media = sqliteTable("media", {
  id: id(),
  post_id: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
  uploader_id: text("uploader_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  blob_path: text("blob_path").notNull(),
  type: text("type", { enum: ["image", "video", "audio", "document", "other"] }).notNull(),
  mime_type: text("mime_type"),
  size_bytes: integer("size_bytes"),
  width: integer("width"),
  height: integer("height"),
  duration_seconds: real("duration_seconds"),
  thumbnail_url: text("thumbnail_url"),
  file_name: text("file_name"),
  sort_order: integer("sort_order").notNull().default(0),
  // ── Cloudflare Stream transcoding (long-form video multi-quality) ────────
  // stream_uid: the Stream video id. stream_status: "none" (no transcode
  // requested/configured) | "processing" | "ready" | "error". qualities is a
  // JSON array of { label, url, height, index } variants built once the HLS
  // manifest is ready — the server-authoritative source for the player's
  // quality selector.
  stream_uid: text("stream_uid"),
  stream_status: text("stream_status").notNull().default("none"),
  qualities: text("qualities"),
  created_at: createdAt(),
}, (table) => [
  index("media_post_sort_idx").on(table.post_id, table.sort_order),
  index("media_uploader_idx").on(table.uploader_id),
]);

// ─── Direct-to-storage upload sessions ──────────────────────────────────────
// Authoritative record of a mobile upload. The server issues a presigned PUT
// (single) or a CreateMultipartUpload + presigned part URLs (multipart); the
// bytes go straight to R2 and NEVER traverse the Vercel request body. The
// media row is only created once the client confirms completion.
//
// status lifecycle: pending → uploading → completed | failed | cancelled
//   pending    — session created, authorization handed to the client
//   uploading  — client reported it started uploading parts
//   completed  — object finalized in R2 and a media row created (media_id set)
//   failed     — a finalize/complete attempt failed
//   cancelled  — client aborted, or the session was swept as abandoned
export const upload_sessions = sqliteTable(
  "upload_sessions",
  {
    id: id(),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // R2 object key — always <folder>/<userId>/<uuid>.<ext> so ownership is
    // intrinsic to the path and can be re-validated before finalization.
    key: text("key").notNull(),
    folder: text("folder").notNull(),
    type: text("type", { enum: ["image", "video", "audio", "document"] }).notNull(),
    mime_type: text("mime_type").notNull(),
    file_name: text("file_name"),
    size_bytes: integer("size_bytes"),
    // R2/S3 multipart upload id (null for the single-PUT mode).
    upload_id: text("upload_id"),
    part_size: integer("part_size"),
    part_count: integer("part_count"),
    // Long-form video: client requested Cloudflare Stream transcoding.
    transcode: integer("transcode", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["pending", "uploading", "completed", "failed", "cancelled"] })
      .notNull()
      .default("pending"),
    media_id: text("media_id"),
    expires_at: text("expires_at").notNull(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => [
    index("upload_sessions_user_idx").on(table.user_id),
    index("upload_sessions_status_idx").on(table.status),
  ],
);

export const post_likes = sqliteTable("post_likes", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  created_at: createdAt(),
});

export const post_views = sqliteTable(
  "post_views",
  {
    id: id(),
    post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    // The authenticated account that watched the content. Anonymous plays are
    // never counted — a view requires an account.
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // Accumulated watch time (seconds) reported by the client. The server keeps
    // the running total so replays and seeks contribute toward the threshold
    // and the account+content relationship caps at exactly one counted view.
    watched_seconds: real("watched_seconds").notNull().default(0),
    // True once this account's view has been counted (posts.view_count + 1).
    // Set exactly once inside the counting transaction — replays never recount.
    counted: integer("counted", { mode: "boolean" }).notNull().default(false),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => [
    uniqueIndex("post_views_post_user_idx").on(table.post_id, table.user_id),
    index("post_views_user_idx").on(table.user_id),
  ],
);

export const saved_posts = sqliteTable("saved_posts", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  created_at: createdAt(),
});

export const hidden_posts = sqliteTable("hidden_posts", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  created_at: createdAt(),
});

// Feed deduplication — records which posts each account has been served in
// discovery feeds (Explore / generic feed / videos / shorts). The ranking
// excludes recently-seen posts (24h window) so the same content isn't shown
// repeatedly, but never permanently — after the window passes, or when the
// viewer is subscribed to the creator (or owns the post), it can resurface.
export const feed_impressions = sqliteTable(
  "feed_impressions",
  {
    id: id(),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    // ISO timestamp of the feed response that included this post.
    seen_at: text("seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("feed_impressions_user_post_idx").on(table.user_id, table.post_id),
    index("feed_impressions_user_seen_idx").on(table.user_id, table.seen_at),
  ],
);

export const categories = sqliteTable("categories", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  created_at: createdAt(),
});

export const post_categories = sqliteTable(
  "post_categories",
  {
    id: id(),
    post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    category_id: text("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("post_categories_post_cat_idx").on(table.post_id, table.category_id),
    index("post_categories_category_idx").on(table.category_id),
  ],
);

// ─── Creator collections / paid content ─────────────────────────────────────

export const albums = sqliteTable(
  "albums",
  {
    id: id(),
    creator_id: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    cover_url: text("cover_url"),
    price_credits: integer("price_credits").notNull().default(0),
    is_premium: integer("is_premium", { mode: "boolean" }).notNull().default(false),
    visibility: text("visibility", { enum: ["public", "subscribers", "private"] }).notNull().default("public"),
    item_count: integer("item_count").notNull().default(0),
    created_at: createdAt(),
    updated_at: updatedAt(),
    deleted_at: text("deleted_at"),
  },
  (table) => [
    index("albums_creator_created_idx").on(table.creator_id, table.created_at),
    index("albums_visibility_created_idx").on(table.visibility, table.created_at),
  ],
);

export const album_items = sqliteTable(
  "album_items",
  {
    id: id(),
    album_id: text("album_id").notNull().references(() => albums.id, { onDelete: "cascade" }),
    media_id: text("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
    sort_order: integer("sort_order").notNull().default(0),
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("album_items_album_media_idx").on(table.album_id, table.media_id),
    index("album_items_album_sort_idx").on(table.album_id, table.sort_order),
    index("album_items_media_idx").on(table.media_id),
  ],
);

export const album_unlocks = sqliteTable(
  "album_unlocks",
  {
    id: id(),
    album_id: text("album_id").notNull().references(() => albums.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credits_spent: integer("credits_spent").notNull().default(0),
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("album_unlocks_album_user_idx").on(table.album_id, table.user_id),
    index("album_unlocks_user_created_idx").on(table.user_id, table.created_at),
  ],
);

// ─── Creator reviews ─────────────────────────────────────────────────────────

export const creator_reviews = sqliteTable(
  "creator_reviews",
  {
    id: id(),
    creator_id: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reviewer_id: text("reviewer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(), // 1–5
    body: text("body"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => [
    uniqueIndex("creator_reviews_creator_reviewer_idx").on(table.creator_id, table.reviewer_id),
    index("creator_reviews_creator_idx").on(table.creator_id),
  ],
);

// ─── Shares ────────────────────────────────────────────────────────────────

export const shares = sqliteTable(
  "shares",
  {
    id: id(),
    creator_id: text("creator_id").references(() => users.id, { onDelete: "set null" }),
    content_type: text("content_type").notNull(), // post | video | short | album | creator
    content_id: text("content_id").notNull(),
    token: text("token").notNull(),
    expires_at: text("expires_at"),
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("shares_token_idx").on(table.token),
    index("shares_content_idx").on(table.content_type, table.content_id),
  ],
);

// ─── Social graph ─────────────────────────────────────────────────────────

export const follows = sqliteTable("follows", {
  id: id(),
  follower_id: text("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  following_id: text("following_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  created_at: createdAt(),
});

export const blocked_users = sqliteTable("blocked_users", {
  id: id(),
  blocker_id: text("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  blocked_id: text("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  created_at: createdAt(),
});

export const muted_users = sqliteTable("muted_users", {
  id: id(),
  muter_id: text("muter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  muted_id: text("muted_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  created_at: createdAt(),
});

export const recent_searches = sqliteTable("recent_searches", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  created_at: createdAt(),
});

// ─── Comments ─────────────────────────────────────────────────────────────

export const comments = sqliteTable("comments", {
  id: id(),
  post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  author_id: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  is_pinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  like_count: integer("like_count").notNull().default(0),
  reply_count: integer("reply_count").notNull().default(0),
  created_at: createdAt(),
  updated_at: updatedAt(),
  deleted_at: text("deleted_at"),
});

export const comment_replies = sqliteTable("comment_replies", {
  id: id(),
  comment_id: text("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),
  author_id: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mention_id: text("mention_id").references(() => users.id),
  body: text("body").notNull(),
  like_count: integer("like_count").notNull().default(0),
  created_at: createdAt(),
  updated_at: updatedAt(),
  deleted_at: text("deleted_at"),
});

export const comment_likes = sqliteTable("comment_likes", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  comment_id: text("comment_id").references(() => comments.id, { onDelete: "cascade" }),
  reply_id: text("reply_id").references(() => comment_replies.id, { onDelete: "cascade" }),
  created_at: createdAt(),
});

// ─── Comment Rooms ─────────────────────────────────────────────────────────
// Every post has exactly one Comment Room. comment_room.id === post.id so the
// post response can return a stable comment_room_id without a join, and the
// mobile app never has to derive it.
export const comment_rooms = sqliteTable(
  "comment_rooms",
  {
    id: id(),
    post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    comments_enabled: integer("comments_enabled", { mode: "boolean" }).notNull().default(true),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => [uniqueIndex("comment_rooms_post_idx").on(table.post_id)],
);

export const reports = sqliteTable("reports", {
  id: id(),
  reporter_id: text("reporter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  entity_type: text("entity_type").notNull(),
  entity_id: text("entity_id").notNull(),
  reason: text("reason").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

// ─── Notifications ────────────────────────────────────────────────────────

export const notifications = sqliteTable("notifications", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actor_id: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  entity_type: text("entity_type"),
  entity_id: text("entity_id"),
  body: text("body"),
  is_read: integer("is_read", { mode: "boolean" }).notNull().default(false),
  created_at: createdAt(),
});

// ─── Monetisation ─────────────────────────────────────────────────────────

export const wallets = sqliteTable("wallets", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  balance: real("balance").notNull().default(0),
  currency: text("currency").notNull().default("NGN"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    amount: real("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("pending"),
    reference: text("reference"),
    paystack_ref: text("paystack_ref"),
    description: text("description"),
    metadata: text("metadata"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => [
    uniqueIndex("transactions_reference_idx")
      .on(table.reference)
      .where(sql`${table.reference} IS NOT NULL`),
  ],
);

export const subscriptions = sqliteTable("subscriptions", {
  id: id(),
  subscriber_id: text("subscriber_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  creator_id: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  // tier: subscription level (subscriber < subscriber_plus)
  tier: text("tier", { enum: ["subscriber", "subscriber_plus"] }),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("NGN"),
  started_at: text("started_at"),
  expires_at: text("expires_at"),
  cancelled_at: text("cancelled_at"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const creator_earnings = sqliteTable(
  "creator_earnings",
  {
    id: id(),
    creator_id: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    buyer_id: text("buyer_id").references(() => users.id, { onDelete: "set null" }),
    source_type: text("source_type").notNull(),
    source_id: text("source_id"),
    transaction_id: text("transaction_id").notNull(),
    gross_amount: real("gross_amount").notNull(),
    platform_fee: real("platform_fee").notNull(),
    net_amount: real("net_amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    created_at: createdAt(),
  },
  (table) => [
    index("creator_earnings_creator_created_idx").on(table.creator_id, table.created_at),
    uniqueIndex("creator_earnings_transaction_idx").on(table.transaction_id),
  ],
);

export const referral_rewards = sqliteTable(
  "referral_rewards",
  {
    id: id(),
    referrer_id: text("referrer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    referred_user_id: text("referred_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    activation_transaction_id: text("activation_transaction_id").notNull(),
    amount: real("amount").notNull().default(200),
    currency: text("currency").notNull().default("NGN"),
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("referral_rewards_referred_user_idx").on(table.referred_user_id),
    uniqueIndex("referral_rewards_activation_tx_idx").on(table.activation_transaction_id),
    index("referral_rewards_referrer_idx").on(table.referrer_id),
  ],
);

export const creator_settings = sqliteTable("creator_settings", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Product default price is ₦200 — never 0. A zero here would make every
  // public route resolve the creator as "free" (see resolveBasePrice).
  subscription_price: real("subscription_price").notNull().default(DEFAULT_SUBSCRIPTION_PRICE),
  // Optional independent price for the subscriber_plus tier. When null, the
  // subscription service falls back to 2× subscription_price for legacy creators.
  subscription_plus_price: real("subscription_plus_price"),
  allow_dms: integer("allow_dms", { mode: "boolean" }).notNull().default(true),
  allow_comments: integer("allow_comments", { mode: "boolean" }).notNull().default(true),
  // ── Private Inbox (creator monetization) ─────────────────────────────────
  // When enabled, other users can pay private_message_price to send this
  // creator one private message. Server-authoritative — the client never sets
  // the price it pays.
  private_inbox_enabled: integer("private_inbox_enabled", { mode: "boolean" }).notNull().default(true),
  private_message_price: real("private_message_price").notNull().default(100),
  // who_can_message: 'everyone' | 'subscribers' | 'none'
  // - 'everyone': Legacy alias — treated as subscriber-only (the product rule
  //   requires an active subscription to send, enforced in the service).
  // - 'subscribers': Only subscribers can message (default).
  // - 'none': No one can message.
  who_can_message: text("who_can_message", { enum: ["everyone", "subscribers", "none"] }).notNull().default("subscribers"),
  welcome_message: text("welcome_message"),
  verification_status: text("verification_status").notNull().default("none"),
  // Dedicated column for withdrawal bank details (JSON: { bankName, accountNumber, accountName })
  bank_details: text("bank_details"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

// ─── Private Inbox ─────────────────────────────────────────────────────────

/**
 * Email-style paid correspondence — NOT a chat room. One row is either the
 * original paid message a fan sent to a creator, or the creator's single
 * reply (parent_message_id points at the original). Threading is exactly
 * one level deep: original → reply.
 *
 * Idempotency: (sender_id, idempotency_key) is unique so a retried submit
 * can never double-charge the wallet or duplicate a message.
 */
export const private_messages = sqliteTable(
  "private_messages",
  {
    id: id(),
    sender_id: text("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    recipient_id: text("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    parent_message_id: text("parent_message_id"),
    body: text("body").notNull(),
    // What the sender actually paid to deliver THIS message (0 for replies).
    price_paid: real("price_paid").notNull().default(0),
    // sent → read → replied (recipient side). No delivery ticks.
    status: text("status", { enum: ["sent", "read", "replied"] }).notNull().default("sent"),
    idempotency_key: text("idempotency_key").notNull(),
    read_at: text("read_at"),
    replied_at: text("replied_at"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => [
    uniqueIndex("private_messages_idempotency_idx").on(table.sender_id, table.idempotency_key),
    uniqueIndex("private_messages_parent_idx").on(table.parent_message_id).where(sql`${table.parent_message_id} IS NOT NULL`),
    index("private_messages_recipient_idx").on(table.recipient_id, table.created_at),
    index("private_messages_sender_idx").on(table.sender_id, table.created_at),
  ],
);

/**
 * Media attached to a private message. Media bytes live in R2 via the
 * standard upload pipeline; only metadata references are stored here.
 * A reply attachment with price > 0 stays LOCKED until the original sender
 * buys it — purchase state lives on this row so a second payment attempt
 * can never succeed after the first.
 */
export const private_message_attachments = sqliteTable(
  "private_message_attachments",
  {
    id: id(),
    message_id: text("message_id").notNull().references(() => private_messages.id, { onDelete: "cascade" }),
    media_id: text("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
    media_type: text("media_type", { enum: ["image", "video", "file"] }).notNull().default("image"),
    price: real("price").notNull().default(0),
    purchased_by: text("purchased_by").references(() => users.id, { onDelete: "set null" }),
    purchase_transaction_id: text("purchase_transaction_id"),
    purchased_at: text("purchased_at"),
    created_at: createdAt(),
  },
  (table) => [
    index("private_message_attachments_message_idx").on(table.message_id),
    uniqueIndex("private_message_attachments_purchase_tx_idx")
      .on(table.purchase_transaction_id)
      .where(sql`${table.purchase_transaction_id} IS NOT NULL`),
  ],
);

// ─── Realtime outbox ────────────────────────────────────────────────────────

/**
 * Durable realtime event log. The WebSocket layer only NOTIFIES clients;
 * this table is what makes reconnects lossless: every durable event gets a
 * monotonic seq and a client that reconnects replays everything since its
 * last seen seq (`sync`). Self-initializes on first use.
 */
export const realtime_events = sqliteTable(
  "realtime_events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull(),
    type: text("type").notNull(),
    channel: text("channel").notNull(),
    user_id: text("user_id"),
    resource_id: text("resource_id"),
    payload: text("payload").notNull(),
    created_at: createdAt(),
  },
  (table) => [index("realtime_events_channel_seq_idx").on(table.channel, table.seq)],
);


