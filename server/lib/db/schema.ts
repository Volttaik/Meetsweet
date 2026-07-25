import { sql } from "drizzle-orm";
import {
  text,
  integer,
  real,
  sqliteTable,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ─── Helpers ────────────────────────────────────────────────────────────────

const id = () => text("id").primaryKey();
const now = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);
const updatedAt = () =>
  text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);
const deletedAt = () => text("deleted_at");

// ─── users ───────────────────────────────────────────────────────────────────

export const users = sqliteTable(
  "users",
  {
    id: id(),
    full_name: text("full_name").notNull(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    password_hash: text("password_hash").notNull(),
    is_verified: integer("is_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    is_creator: integer("is_creator", { mode: "boolean" })
      .notNull()
      .default(false),
    is_active: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    role: text("role", { enum: ["user", "creator", "admin"] })
      .notNull()
      .default("user"),
    created_at: now(),
    updated_at: updatedAt(),
    deleted_at: deletedAt(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_username_idx").on(t.username),
    index("users_phone_idx").on(t.phone),
  ]
);

// ─── profiles ────────────────────────────────────────────────────────────────

export const profiles = sqliteTable("profiles", {
  id: id(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  display_name: text("display_name"),
  bio: text("bio"),
  avatar_url: text("avatar_url"),
  banner_url: text("banner_url"),
  website: text("website"),
  location: text("location"),
  is_verified_creator: integer("is_verified_creator", { mode: "boolean" })
    .notNull()
    .default(false),
  subscription_price: real("subscription_price").default(0),
  created_at: now(),
  updated_at: updatedAt(),
});

// ─── sessions ────────────────────────────────────────────────────────────────

export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token_hash: text("token_hash").notNull(),
    device_id: text("device_id"),
    ip_address: text("ip_address"),
    user_agent: text("user_agent"),
    expires_at: text("expires_at").notNull(),
    created_at: now(),
  },
  (t) => [index("sessions_user_id_idx").on(t.user_id)]
);

// ─── verification_codes ──────────────────────────────────────────────────────

export const verification_codes = sqliteTable(
  "verification_codes",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    type: text("type", {
      enum: ["email_verify", "password_reset", "phone_verify"],
    }).notNull(),
    expires_at: text("expires_at").notNull(),
    used_at: text("used_at"),
    created_at: now(),
  },
  (t) => [index("vcodes_user_type_idx").on(t.user_id, t.type)]
);

// ─── refresh_tokens ──────────────────────────────────────────────────────────

export const refresh_tokens = sqliteTable(
  "refresh_tokens",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token_hash: text("token_hash").notNull(),
    device_id: text("device_id"),
    expires_at: text("expires_at").notNull(),
    revoked_at: text("revoked_at"),
    created_at: now(),
  },
  (t) => [
    index("rt_user_id_idx").on(t.user_id),
    uniqueIndex("rt_token_hash_idx").on(t.token_hash),
  ]
);

// ─── devices ─────────────────────────────────────────────────────────────────

export const devices = sqliteTable(
  "devices",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    push_token: text("push_token"),
    platform: text("platform", { enum: ["ios", "android", "web"] }),
    device_name: text("device_name"),
    last_seen_at: text("last_seen_at"),
    created_at: now(),
  },
  (t) => [index("devices_user_id_idx").on(t.user_id)]
);

// ─── posts ───────────────────────────────────────────────────────────────────

export const posts = sqliteTable(
  "posts",
  {
    id: id(),
    creator_id: text("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caption: text("caption"),
    visibility: text("visibility", {
      enum: ["public", "subscribers", "private"],
    })
      .notNull()
      .default("public"),
    status: text("status", {
      enum: ["draft", "published", "archived", "deleted"],
    })
      .notNull()
      .default("draft"),
    is_pinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    preview_duration: integer("preview_duration"),
    expires_at: text("expires_at"),
    published_at: text("published_at"),
    unlock_price: real("unlock_price").default(0),
    view_count: integer("view_count").notNull().default(0),
    like_count: integer("like_count").notNull().default(0),
    comment_count: integer("comment_count").notNull().default(0),
    save_count: integer("save_count").notNull().default(0),
    created_at: now(),
    updated_at: updatedAt(),
    deleted_at: deletedAt(),
  },
  (t) => [
    index("posts_creator_id_idx").on(t.creator_id),
    index("posts_status_idx").on(t.status),
    index("posts_published_at_idx").on(t.published_at),
  ]
);

// ─── media ───────────────────────────────────────────────────────────────────

export const media = sqliteTable(
  "media",
  {
    id: id(),
    post_id: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
    uploader_id: text("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    blob_path: text("blob_path").notNull(),
    type: text("type", { enum: ["image", "video", "audio"] }).notNull(),
    mime_type: text("mime_type"),
    size_bytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    duration_seconds: real("duration_seconds"),
    sort_order: integer("sort_order").notNull().default(0),
    created_at: now(),
  },
  (t) => [index("media_post_id_idx").on(t.post_id)]
);

// ─── archives ────────────────────────────────────────────────────────────────

export const archives = sqliteTable(
  "archives",
  {
    id: id(),
    post_id: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    creator_id: text("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    archived_at: now(),
    price: real("price").default(0),
    is_purchasable: integer("is_purchasable", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [index("archives_creator_id_idx").on(t.creator_id)]
);

// ─── comments ────────────────────────────────────────────────────────────────

export const comments = sqliteTable(
  "comments",
  {
    id: id(),
    post_id: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    author_id: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    is_pinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    like_count: integer("like_count").notNull().default(0),
    reply_count: integer("reply_count").notNull().default(0),
    created_at: now(),
    updated_at: updatedAt(),
    deleted_at: deletedAt(),
  },
  (t) => [index("comments_post_id_idx").on(t.post_id)]
);

// ─── comment_replies ─────────────────────────────────────────────────────────

export const comment_replies = sqliteTable(
  "comment_replies",
  {
    id: id(),
    comment_id: text("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    author_id: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mention_id: text("mention_id").references(() => users.id),
    body: text("body").notNull(),
    like_count: integer("like_count").notNull().default(0),
    created_at: now(),
    updated_at: updatedAt(),
    deleted_at: deletedAt(),
  },
  (t) => [index("replies_comment_id_idx").on(t.comment_id)]
);

// ─── comment_likes ───────────────────────────────────────────────────────────

export const comment_likes = sqliteTable(
  "comment_likes",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    comment_id: text("comment_id").references(() => comments.id, {
      onDelete: "cascade",
    }),
    reply_id: text("reply_id").references(() => comment_replies.id, {
      onDelete: "cascade",
    }),
    created_at: now(),
  },
  (t) => [index("comment_likes_user_idx").on(t.user_id, t.comment_id)]
);

// ─── post interactions ───────────────────────────────────────────────────────

export const saved_posts = sqliteTable(
  "saved_posts",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    post_id: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    created_at: now(),
  },
  (t) => [
    uniqueIndex("saved_posts_unique_idx").on(t.user_id, t.post_id),
    index("saved_posts_user_idx").on(t.user_id),
  ]
);

export const post_likes = sqliteTable(
  "post_likes",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    post_id: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    created_at: now(),
  },
  (t) => [uniqueIndex("post_likes_unique_idx").on(t.user_id, t.post_id)]
);

export const post_views = sqliteTable(
  "post_views",
  {
    id: id(),
    user_id: text("user_id").references(() => users.id, { onDelete: "set null" }),
    post_id: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    created_at: now(),
  },
  (t) => [index("post_views_post_idx").on(t.post_id)]
);

// ─── blocked_users ───────────────────────────────────────────────────────────

export const blocked_users = sqliteTable(
  "blocked_users",
  {
    id: id(),
    blocker_id: text("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blocked_id: text("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: now(),
  },
  (t) => [uniqueIndex("blocked_unique_idx").on(t.blocker_id, t.blocked_id)]
);

// ─── muted_users ─────────────────────────────────────────────────────────────

export const muted_users = sqliteTable(
  "muted_users",
  {
    id: id(),
    muter_id: text("muter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    muted_id: text("muted_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: now(),
  },
  (t) => [uniqueIndex("muted_unique_idx").on(t.muter_id, t.muted_id)]
);

// ─── subscriptions ───────────────────────────────────────────────────────────

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: id(),
    subscriber_id: text("subscriber_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    creator_id: text("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["active", "cancelled", "expired", "pending"],
    })
      .notNull()
      .default("pending"),
    amount: real("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    started_at: text("started_at"),
    expires_at: text("expires_at"),
    cancelled_at: text("cancelled_at"),
    created_at: now(),
    updated_at: updatedAt(),
  },
  (t) => [
    index("subs_subscriber_idx").on(t.subscriber_id),
    index("subs_creator_idx").on(t.creator_id),
    index("subs_status_idx").on(t.status),
  ]
);

// ─── wallets ─────────────────────────────────────────────────────────────────

export const wallets = sqliteTable("wallets", {
  id: id(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  balance: real("balance").notNull().default(0),
  currency: text("currency").notNull().default("NGN"),
  created_at: now(),
  updated_at: updatedAt(),
});

// ─── transactions ────────────────────────────────────────────────────────────

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["credit", "debit", "refund", "subscription", "purchase"],
    }).notNull(),
    amount: real("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status", {
      enum: ["pending", "success", "failed", "refunded"],
    })
      .notNull()
      .default("pending"),
    reference: text("reference"),
    paystack_ref: text("paystack_ref"),
    description: text("description"),
    metadata: text("metadata"), // JSON string
    created_at: now(),
    updated_at: updatedAt(),
  },
  (t) => [
    index("transactions_user_idx").on(t.user_id),
    index("transactions_ref_idx").on(t.reference),
  ]
);

// ─── notifications ───────────────────────────────────────────────────────────

export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actor_id: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    type: text("type", {
      enum: [
        "like",
        "comment",
        "reply",
        "mention",
        "subscription",
        "payment",
        "message",
        "system",
      ],
    }).notNull(),
    entity_type: text("entity_type"),
    entity_id: text("entity_id"),
    body: text("body"),
    is_read: integer("is_read", { mode: "boolean" }).notNull().default(false),
    created_at: now(),
  },
  (t) => [
    index("notifs_user_idx").on(t.user_id),
    index("notifs_read_idx").on(t.user_id, t.is_read),
  ]
);

// ─── conversations ───────────────────────────────────────────────────────────

export const conversations = sqliteTable("conversations", {
  id: id(),
  type: text("type", { enum: ["direct", "group"] }).notNull().default("direct"),
  name: text("name"),
  avatar_url: text("avatar_url"),
  last_message_at: text("last_message_at"),
  created_by: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  created_at: now(),
  updated_at: updatedAt(),
});

// ─── conversation_members ────────────────────────────────────────────────────

export const conversation_members = sqliteTable(
  "conversation_members",
  {
    id: id(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    is_muted: integer("is_muted", { mode: "boolean" }).notNull().default(false),
    is_pinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    is_archived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    last_read_at: text("last_read_at"),
    joined_at: now(),
  },
  (t) => [
    uniqueIndex("conv_members_unique_idx").on(t.conversation_id, t.user_id),
    index("conv_members_user_idx").on(t.user_id),
  ]
);

// ─── messages ────────────────────────────────────────────────────────────────

export const messages = sqliteTable(
  "messages",
  {
    id: id(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sender_id: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reply_to_id: text("reply_to_id"),
    type: text("type", {
      enum: ["text", "image", "video", "audio", "file"],
    })
      .notNull()
      .default("text"),
    body: text("body"),
    media_url: text("media_url"),
    media_blob_path: text("media_blob_path"),
    reactions: text("reactions"), // JSON: { emoji: userId[] }
    is_edited: integer("is_edited", { mode: "boolean" }).notNull().default(false),
    is_recalled: integer("is_recalled", { mode: "boolean" })
      .notNull()
      .default(false),
    is_pinned: integer("is_pinned", { mode: "boolean" })
      .notNull()
      .default(false),
    created_at: now(),
    updated_at: updatedAt(),
    deleted_at: deletedAt(),
  },
  (t) => [
    index("messages_conv_idx").on(t.conversation_id),
    index("messages_sender_idx").on(t.sender_id),
    index("messages_created_idx").on(t.conversation_id, t.created_at),
  ]
);

// ─── message_reads ───────────────────────────────────────────────────────────

export const message_reads = sqliteTable(
  "message_reads",
  {
    id: id(),
    message_id: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    read_at: now(),
  },
  (t) => [uniqueIndex("msg_reads_unique_idx").on(t.message_id, t.user_id)]
);

// ─── creator_settings ────────────────────────────────────────────────────────

export const creator_settings = sqliteTable("creator_settings", {
  id: id(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  subscription_price: real("subscription_price").notNull().default(0),
  allow_dms: integer("allow_dms", { mode: "boolean" }).notNull().default(true),
  allow_comments: integer("allow_comments", { mode: "boolean" })
    .notNull()
    .default(true),
  welcome_message: text("welcome_message"),
  verification_status: text("verification_status", {
    enum: ["none", "pending", "approved", "rejected"],
  })
    .notNull()
    .default("none"),
  created_at: now(),
  updated_at: updatedAt(),
});

// ─── creator_statistics ──────────────────────────────────────────────────────

export const creator_statistics = sqliteTable(
  "creator_statistics",
  {
    id: id(),
    creator_id: text("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // e.g. "2025-01"
    total_subscribers: integer("total_subscribers").notNull().default(0),
    new_subscribers: integer("new_subscribers").notNull().default(0),
    total_revenue: real("total_revenue").notNull().default(0),
    total_views: integer("total_views").notNull().default(0),
    total_likes: integer("total_likes").notNull().default(0),
    total_posts: integer("total_posts").notNull().default(0),
    created_at: now(),
    updated_at: updatedAt(),
  },
  (t) => [
    index("creator_stats_idx").on(t.creator_id, t.period),
    uniqueIndex("creator_stats_unique_idx").on(t.creator_id, t.period),
  ]
);

// ─── reports ─────────────────────────────────────────────────────────────────

export const reports = sqliteTable(
  "reports",
  {
    id: id(),
    reporter_id: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entity_type: text("entity_type", {
      enum: ["post", "comment", "user", "message"],
    }).notNull(),
    entity_id: text("entity_id").notNull(),
    reason: text("reason").notNull(),
    description: text("description"),
    status: text("status", { enum: ["pending", "reviewed", "dismissed"] })
      .notNull()
      .default("pending"),
    created_at: now(),
    updated_at: updatedAt(),
  },
  (t) => [index("reports_entity_idx").on(t.entity_type, t.entity_id)]
);

// ─── recent_searches ─────────────────────────────────────────────────────────

export const recent_searches = sqliteTable(
  "recent_searches",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    created_at: now(),
  },
  (t) => [index("recent_searches_user_idx").on(t.user_id)]
);

// ─── follows ─────────────────────────────────────────────────────────────────

export const follows = sqliteTable(
  "follows",
  {
    id: id(),
    follower_id: text("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    following_id: text("following_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: now(),
  },
  (t) => [
    uniqueIndex("follows_unique_idx").on(t.follower_id, t.following_id),
    index("follows_follower_idx").on(t.follower_id),
    index("follows_following_idx").on(t.following_id),
  ]
);

// ─── categories ──────────────────────────────────────────────────────────────

export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    post_count: integer("post_count").notNull().default(0),
    created_at: now(),
  },
  (t) => [uniqueIndex("categories_slug_idx").on(t.slug)]
);

// ─── hidden_posts ────────────────────────────────────────────────────────────

export const hidden_posts = sqliteTable(
  "hidden_posts",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    post_id: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    created_at: now(),
  },
  (t) => [uniqueIndex("hidden_posts_unique_idx").on(t.user_id, t.post_id)]
);

// ─── user_settings ───────────────────────────────────────────────────────────

export const user_settings = sqliteTable("user_settings", {
  id: id(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Appearance
  theme: text("theme", { enum: ["light", "dark", "system"] })
    .notNull()
    .default("system"),
  language: text("language").notNull().default("en"),
  // Notification toggles
  notif_likes: integer("notif_likes", { mode: "boolean" })
    .notNull()
    .default(true),
  notif_comments: integer("notif_comments", { mode: "boolean" })
    .notNull()
    .default(true),
  notif_follows: integer("notif_follows", { mode: "boolean" })
    .notNull()
    .default(true),
  notif_messages: integer("notif_messages", { mode: "boolean" })
    .notNull()
    .default(true),
  notif_subscriptions: integer("notif_subscriptions", { mode: "boolean" })
    .notNull()
    .default(true),
  // Privacy
  private_account: integer("private_account", { mode: "boolean" })
    .notNull()
    .default(false),
  show_online_status: integer("show_online_status", { mode: "boolean" })
    .notNull()
    .default(true),
  show_read_receipts: integer("show_read_receipts", { mode: "boolean" })
    .notNull()
    .default(true),
  typing_indicator: integer("typing_indicator", { mode: "boolean" })
    .notNull()
    .default(true),
  sensitive_content: integer("sensitive_content", { mode: "boolean" })
    .notNull()
    .default(false),
  // App preferences
  data_saver: integer("data_saver", { mode: "boolean" })
    .notNull()
    .default(false),
  autoplay_media: integer("autoplay_media", { mode: "boolean" })
    .notNull()
    .default(true),
  biometric_login: integer("biometric_login", { mode: "boolean" })
    .notNull()
    .default(false),
  created_at: now(),
  updated_at: updatedAt(),
});

// ─── login_history ───────────────────────────────────────────────────────────

export const login_history = sqliteTable(
  "login_history",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip_address: text("ip_address"),
    user_agent: text("user_agent"),
    device_id: text("device_id"),
    status: text("status", { enum: ["success", "failed"] })
      .notNull()
      .default("success"),
    created_at: now(),
  },
  (t) => [index("login_history_user_idx").on(t.user_id)]
);

// ─── withdrawals ─────────────────────────────────────────────────────────────

export const withdrawals = sqliteTable(
  "withdrawals",
  {
    id: id(),
    creator_id: text("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: real("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    bank_code: text("bank_code"),
    account_number: text("account_number"),
    account_name: text("account_name"),
    status: text("status", {
      enum: ["pending", "processing", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    reference: text("reference"),
    note: text("note"),
    created_at: now(),
    updated_at: updatedAt(),
  },
  (t) => [index("withdrawals_creator_idx").on(t.creator_id)]
);

// ─── content_purchases ───────────────────────────────────────────────────────

export const content_purchases = sqliteTable(
  "content_purchases",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    post_id: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    amount: real("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    purchased_at: now(),
  },
  (t) => [
    uniqueIndex("content_purchases_unique_idx").on(t.user_id, t.post_id),
    index("content_purchases_user_idx").on(t.user_id),
  ]
);
