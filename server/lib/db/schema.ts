import { sql } from "drizzle-orm";
import {
  index,
  integer,
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
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  display_name: text("display_name"),
  avatar_url: text("avatar_url"),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const credential_grants = sqliteTable(
  "credential_grants",
  {
    id: id(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    created_at: createdAt(),
  },
  (table) => [index("verification_codes_user_type_idx").on(table.user_id, table.type)],
);

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
    created_at: createdAt(),
  },
  (table) => [
    uniqueIndex("refresh_tokens_hash_idx").on(table.token_hash),
    index("refresh_tokens_user_idx").on(table.user_id),
  ],
);

export const user_settings = sqliteTable("user_settings", {
  id: id(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  biometric_login: integer("biometric_login", { mode: "boolean" })
    .notNull()
    .default(false),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

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
    created_at: createdAt(),
  },
  (table) => [index("login_history_user_idx").on(table.user_id)],
);