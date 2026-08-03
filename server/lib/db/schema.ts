import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_username_idx").on(table.username),
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
  is_verified_creator: integer("is_verified_creator", { mode: "boolean" }).notNull().default(false),
  subscription_price: real("subscription_price").default(0),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const user_settings = sqliteTable("user_settings", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  push_notifications: integer("push_notifications", { mode: "boolean" }).notNull().default(true),
  email_notifications: integer("email_notifications", { mode: "boolean" }).notNull().default(true),
  dark_mode: integer("dark_mode", { mode: "boolean" }).notNull().default(true),
  data_saver: integer("data_saver", { mode: "boolean" }).notNull().default(false),
  autoplay_media: integer("autoplay_media", { mode: "boolean" }).notNull().default(true),
  biometric_login: integer("biometric_login", { mode: "boolean" }).notNull().default(false),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const verification_codes = sqliteTable(
  "verification_codes",
  {
    id: id(),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    type: text("type", { enum: ["email_verify", "password_reset", "phone_verify"] }).notNull(),
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
  // content_type distinguishes posts / long-form videos / shorts
  content_type: text("content_type", { enum: ["post", "video", "short"] }).notNull().default("post"),
  title: text("title"),
  caption: text("caption"),
  description: text("description"),
  visibility: text("visibility", { enum: ["public", "subscribers", "draft"] }).notNull().default("public"),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  is_pinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  preview_duration: integer("preview_duration"),
  unlock_price: integer("unlock_price"),
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
  created_at: createdAt(),
}, (table) => [
  index("media_post_sort_idx").on(table.post_id, table.sort_order),
  index("media_uploader_idx").on(table.uploader_id),
]);

export const post_likes = sqliteTable("post_likes", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  created_at: createdAt(),
});

export const post_views = sqliteTable("post_views", {
  id: id(),
  user_id: text("user_id").references(() => users.id, { onDelete: "set null" }),
  post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  created_at: createdAt(),
});

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

export const archives = sqliteTable("archives", {
  id: id(),
  post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  creator_id: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  price: real("price").default(0),
  is_purchasable: integer("is_purchasable", { mode: "boolean" }).notNull().default(false),
  created_at: createdAt(),
});

export const categories = sqliteTable("categories", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  post_count: integer("post_count").notNull().default(0),
  created_at: createdAt(),
});

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

export const post_unlocks = sqliteTable(
  "post_unlocks",
  {
    id: id(),
    post_id: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credits_spent: integer("credits_spent").notNull().default(0),
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("post_unlocks_post_user_idx").on(table.post_id, table.user_id),
    index("post_unlocks_user_created_idx").on(table.user_id, table.created_at),
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

// ─── Messaging ────────────────────────────────────────────────────────────

export const conversations = sqliteTable("conversations", {
  id: id(),
  type: text("type", { enum: ["direct", "group"] }).notNull().default("direct"),
  name: text("name"),
  avatar_url: text("avatar_url"),
  last_message_at: text("last_message_at"),
  created_by: text("created_by").references(() => users.id, { onDelete: "set null" }),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const conversation_members = sqliteTable("conversation_members", {
  id: id(),
  conversation_id: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  is_muted: integer("is_muted", { mode: "boolean" }).notNull().default(false),
  is_pinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  is_archived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  last_read_at: text("last_read_at"),
  created_at: createdAt(),
});

export const messages = sqliteTable("messages", {
  id: id(),
  conversation_id: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  sender_id: text("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reply_to_id: text("reply_to_id"),
  type: text("type").notNull().default("text"),
  body: text("body"),
  caption: text("caption"),
  media_url: text("media_url"),
  media_blob_path: text("media_blob_path"),
  mime_type: text("mime_type"),
  file_name: text("file_name"),
  file_size: integer("file_size"),
  audio_duration: real("audio_duration"),
  is_paid: integer("is_paid", { mode: "boolean" }).notNull().default(false),
  paid_price: integer("paid_price"),
  reactions: text("reactions"),
  is_edited: integer("is_edited", { mode: "boolean" }).notNull().default(false),
  is_recalled: integer("is_recalled", { mode: "boolean" }).notNull().default(false),
  created_at: createdAt(),
  updated_at: updatedAt(),
  deleted_at: text("deleted_at"),
});

export const message_unlocks = sqliteTable(
  "message_unlocks",
  {
    id: id(),
    message_id: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credits_spent: integer("credits_spent").notNull().default(0),
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("message_unlocks_msg_user_idx").on(table.message_id, table.user_id),
  ],
);

export const message_reads = sqliteTable("message_reads", {
  id: id(),
  message_id: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  created_at: createdAt(),
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

export const transactions = sqliteTable("transactions", {
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
});

export const subscriptions = sqliteTable("subscriptions", {
  id: id(),
  subscriber_id: text("subscriber_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  creator_id: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("NGN"),
  started_at: text("started_at"),
  expires_at: text("expires_at"),
  cancelled_at: text("cancelled_at"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const creator_settings = sqliteTable("creator_settings", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subscription_price: real("subscription_price").notNull().default(0),
  allow_dms: integer("allow_dms", { mode: "boolean" }).notNull().default(true),
  allow_comments: integer("allow_comments", { mode: "boolean" }).notNull().default(true),
  // who_can_message: 'everyone' | 'subscribers' | 'none'
  // - 'everyone': Anyone can message
  // - 'subscribers': Only subscribers can message
  // - 'none': No one can message
  who_can_message: text("who_can_message", { enum: ["everyone", "subscribers", "none"] }).notNull().default("everyone"),
  welcome_message: text("welcome_message"),
  verification_status: text("verification_status").notNull().default("none"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const creator_statistics = sqliteTable("creator_statistics", {
  id: id(),
  creator_id: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  total_subscribers: integer("total_subscribers").notNull().default(0),
  new_subscribers: integer("new_subscribers").notNull().default(0),
  total_revenue: real("total_revenue").notNull().default(0),
  total_views: integer("total_views").notNull().default(0),
  total_likes: integer("total_likes").notNull().default(0),
  total_posts: integer("total_posts").notNull().default(0),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

// ─── Creator Payouts ─────────────────────────────────────────────────────────

export const creator_bank_details = sqliteTable("creator_bank_details", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bank_name: text("bank_name").notNull(),
  account_number: text("account_number").notNull(),
  account_name: text("account_name").notNull(),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const creator_withdrawals = sqliteTable("creator_withdrawals", {
  id: id(),
  user_id: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  bank_name: text("bank_name").notNull(),
  account_number: text("account_number").notNull(),
  account_name: text("account_name").notNull(),
  reference: text("reference"),
  created_at: createdAt(),
  updated_at: updatedAt(),
}, (table) => [
  index("creator_withdrawals_user_status_idx").on(table.user_id, table.status),
]);
