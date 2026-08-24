import { NextRequest } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  users,
  profiles,
  follows,
  posts,
  albums,
  comments,
  comment_replies,
  comment_likes,
  subscriptions,
  refresh_tokens,
  creator_settings,
  sessions,
  devices,
  credential_grants,
  verification_codes,
  login_history,
  blocked_users,
  muted_users,
  post_likes,
  saved_posts,
  hidden_posts,
  recent_searches,
  notifications,
  user_settings,
  wallets,
} from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { verifyPassword } from "@/lib/auth/password";
import { resolveBasePrice } from "@/lib/services/pricing";

/**
 * Resolve the user's creator pricing from the authoritative creator_settings,
 * falling back to the legacy profiles.subscription_price. Kept identical to the
 * public /creators/[id] endpoint so a creator's own profile never advertises a
 * different price than their followers see.
 */
async function getResolvedPrices(userId: string): Promise<{
  subscription_price: number;
  subscription_plus_price: number | null;
}> {
  const [settings] = await db
    .select({
      subscription_price: creator_settings.subscription_price,
      subscription_plus_price: creator_settings.subscription_plus_price,
    })
    .from(creator_settings)
    .where(eq(creator_settings.user_id, userId))
    .limit(1);
  const [profile] = await db
    .select({ subscription_price: profiles.subscription_price })
    .from(profiles)
    .where(eq(profiles.user_id, userId))
    .limit(1);
  const base = resolveBasePrice(settings?.subscription_price, profile?.subscription_price);
  return {
    subscription_price: base,
    subscription_plus_price:
      settings?.subscription_plus_price ?? (base > 0 ? Math.round(base * 2) : null),
  };
}

const patchSchema = z.object({
  full_name: z.string().min(2).max(100).optional(),
  display_name: z.string().min(1).max(100).optional(),
  username: z.string().min(2).max(30).regex(/^[a-zA-Z0-9_]+$/, "Only letters, numbers and underscores").optional(),
  bio: z.string().max(300).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  banner_url: z.string().url().nullable().optional(),
  website: z.string().url().nullable().optional(),
  location: z.string().max(100).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const [row] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
      phone: users.phone,
      role: users.role,
      is_creator: users.is_creator,
      is_verified: users.is_verified,
      two_fa_enabled: users.two_fa_enabled,
      created_at: users.created_at,
      display_name: profiles.display_name,
      bio: profiles.bio,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      website: profiles.website,
      location: profiles.location,
      is_verified_creator: profiles.is_verified_creator,
      category: profiles.category,
      subscription_price: profiles.subscription_price,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(and(eq(users.id, auth.user.userId), eq(users.is_active, true), isNull(users.deleted_at)))
    .limit(1);

  // A valid token pointing at a missing or disabled user is an invalid session,
  // not a missing route. Return 401 (not 404) so the client clears the stale
  // session and re-authenticates instead of silently keeping a dead session.
  if (!row) return err("Session is no longer valid", 401, "UNAUTHORIZED");

  // Follower / following / post counts
  const [followerCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(follows)
    .where(eq(follows.following_id, auth.user.userId));

  const [followingCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(follows)
    .where(eq(follows.follower_id, auth.user.userId));

  const [postCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(posts)
    .where(and(eq(posts.creator_id, auth.user.userId), isNull(posts.deleted_at)));

  // subscriber_count: people actively subscribed to this user as a creator
  // subscription_count: creators this user is actively subscribed to
  const [subscriberCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(and(eq(subscriptions.creator_id, auth.user.userId), eq(subscriptions.status, "active")));

  const [subscriptionCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(and(eq(subscriptions.subscriber_id, auth.user.userId), eq(subscriptions.status, "active")));

  const prices = await getResolvedPrices(auth.user.userId);

  // Mobile's normalizeUser(raw) is called directly on the unwrapped data,
  // so we return the user fields at the top level (not wrapped in {user:...}).
  return ok({
    ...row,
    ...prices,
    follower_count: followerCount?.count ?? 0,
    following_count: followingCount?.count ?? 0,
    post_count: postCount?.count ?? 0,
    subscriber_count: subscriberCount?.count ?? 0,
    subscription_count: subscriptionCount?.count ?? 0,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.success) return parsed.response;

  const { full_name, display_name, username, bio, avatar_url, banner_url, website, location, category, phone } = parsed.data;
  const now = new Date().toISOString();

  // Build users-table update (fields that live on the users row)
  const userUpdates: Record<string, unknown> = { updated_at: now };
  if (full_name !== undefined) userUpdates.full_name = full_name;
  if (phone !== undefined) userUpdates.phone = phone;

  if (username !== undefined) {
    // Check username uniqueness
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (taken && taken.id !== auth.user.userId) return err("Username already taken", 409, "USERNAME_TAKEN");
    userUpdates.username = username;
  }

  if (Object.keys(userUpdates).length > 1) {
    await db.update(users).set(userUpdates).where(eq(users.id, auth.user.userId));
  }

  const profileUpdates: Record<string, unknown> = { updated_at: now };
  if (display_name !== undefined) profileUpdates.display_name = display_name;
  if (bio !== undefined) profileUpdates.bio = bio;
  if (avatar_url !== undefined) profileUpdates.avatar_url = avatar_url;
  if (banner_url !== undefined) profileUpdates.banner_url = banner_url;
  if (website !== undefined) profileUpdates.website = website;
  if (location !== undefined) profileUpdates.location = location;
  if (category !== undefined) profileUpdates.category = category;

  if (Object.keys(profileUpdates).length > 1) {
    await db.update(profiles).set(profileUpdates).where(eq(profiles.user_id, auth.user.userId));
  }

  const [row] = await db
    .select({
      id: users.id,
      full_name: users.full_name,
      username: users.username,
      email: users.email,
      phone: users.phone,
      role: users.role,
      is_creator: users.is_creator,
      is_verified: users.is_verified,
      two_fa_enabled: users.two_fa_enabled,
      created_at: users.created_at,
      display_name: profiles.display_name,
      bio: profiles.bio,
      avatar_url: profiles.avatar_url,
      banner_url: profiles.banner_url,
      website: profiles.website,
      location: profiles.location,
      is_verified_creator: profiles.is_verified_creator,
      category: profiles.category,
      subscription_price: profiles.subscription_price,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  const prices = await getResolvedPrices(auth.user.userId);
  return ok({ user: { ...row, ...prices } });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(
    req,
    z.object({ password: z.string().min(1) }),
  );
  if (!parsed.success) return parsed.response;

  const [user] = await db
    .select({ id: users.id, password_hash: users.password_hash })
    .from(users)
    .where(eq(users.id, auth.user.userId))
    .limit(1);

  if (!user) return err("User not found", 404);

  const valid = await verifyPassword(user.password_hash, parsed.data.password);
  if (!valid) return err("Password is incorrect", 400, "WRONG_PASSWORD");

  const uid = user.id;
  const now = new Date().toISOString();

  // One atomic transaction: deactivate + free the identity + remove every
  // account-owned resource so nothing about the deleted account remains
  // accessible through the application. `transactions` rows are intentionally
  // kept (financial audit trail); the user row is deactivated/placeholder'd so
  // no live account can reference them.
  await db.transaction(async (tx) => {
    // ── Sessions & tokens — immediate lockout ────────────────────────────
    await tx.update(refresh_tokens).set({ revoked_at: now }).where(eq(refresh_tokens.user_id, uid));
    await tx.delete(sessions).where(eq(sessions.user_id, uid));
    await tx.delete(devices).where(eq(devices.user_id, uid));
    await tx.delete(credential_grants).where(eq(credential_grants.user_id, uid));
    await tx.delete(verification_codes).where(eq(verification_codes.user_id, uid));
    await tx.delete(login_history).where(eq(login_history.user_id, uid));

    // ── Account-owned content — soft-delete so it leaves every feed ──────
    // Covers posts, videos, shorts (content_type on posts) and album rows.
    await tx.update(posts)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(posts.creator_id, uid), isNull(posts.deleted_at)));
    await tx.update(albums)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(albums.creator_id, uid), isNull(albums.deleted_at)));
    await tx.update(comments)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(comments.author_id, uid), isNull(comments.deleted_at)));
    await tx.update(comment_replies)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(comment_replies.author_id, uid), isNull(comment_replies.deleted_at)));

    // ── Social graph & preferences ───────────────────────────────────────
    await tx.delete(follows).where(or(eq(follows.follower_id, uid), eq(follows.following_id, uid)));
    await tx.delete(blocked_users).where(or(eq(blocked_users.blocker_id, uid), eq(blocked_users.blocked_id, uid)));
    await tx.delete(muted_users).where(or(eq(muted_users.muter_id, uid), eq(muted_users.muted_id, uid)));
    await tx.delete(post_likes).where(eq(post_likes.user_id, uid));
    await tx.delete(comment_likes).where(eq(comment_likes.user_id, uid));
    await tx.delete(saved_posts).where(eq(saved_posts.user_id, uid));
    await tx.delete(hidden_posts).where(eq(hidden_posts.user_id, uid));
    await tx.delete(recent_searches).where(eq(recent_searches.user_id, uid));

    // ── Subscriptions — cancel both directions ───────────────────────────
    // As a subscriber (to other creators) and as a creator (their subscribers).
    await tx.update(subscriptions)
      .set({ status: "cancelled", cancelled_at: now, updated_at: now })
      .where(and(
        or(eq(subscriptions.subscriber_id, uid), eq(subscriptions.creator_id, uid)),
        or(eq(subscriptions.status, "active"), eq(subscriptions.status, "pending")),
      ));

    // ── Notifications / settings / wallet ────────────────────────────────
    await tx.delete(notifications).where(eq(notifications.user_id, uid));
    await tx.delete(user_settings).where(eq(user_settings.user_id, uid));
    await tx.delete(wallets).where(eq(wallets.user_id, uid));

    // ── Deactivate + free the identity for re-registration ───────────────
    // email/username become unique placeholders so the ORIGINAL email and
    // username are immediately reusable by a new registration (the register
    // route ignores deleted accounts for its duplicate check).
    await tx.update(users)
      .set({
        deleted_at: now,
        is_active: false,
        email: `deleted_${uid}@deleted.local`,
        username: `deleted_${uid}`,
        phone: null,
        updated_at: now,
      })
      .where(eq(users.id, uid));
  });

  return ok({ deleted: true });
}
