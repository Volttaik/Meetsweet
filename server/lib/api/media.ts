/**
 * Helpers for signing R2 keys in API responses.
 * Import resolveUrl from r2.ts and use these wrappers to
 * avoid repetition in route handlers.
 */
import { resolveUrl } from "@/lib/services/r2";

type WithAvatarBanner = {
  avatar_url?: string | null;
  banner_url?: string | null;
};

type WithCreatorAvatar = {
  creator_avatar?: string | null;
};

type WithActorAvatar = {
  actor_avatar?: string | null;
};

type WithSenderAvatar = {
  sender_avatar?: string | null;
};

type WithAuthorAvatar = {
  author_avatar?: string | null;
};

/** Sign avatar_url and banner_url for a single profile-like object. */
export async function signProfile<T extends WithAvatarBanner>(row: T): Promise<T> {
  return {
    ...row,
    avatar_url: await resolveUrl(row.avatar_url),
    banner_url: await resolveUrl(row.banner_url),
  };
}

export async function signProfiles<T extends WithAvatarBanner>(rows: T[]): Promise<T[]> {
  return Promise.all(rows.map(signProfile));
}

/** Sign creator_avatar in a post row. */
export async function signPostRow<T extends WithCreatorAvatar & { media?: { url: string }[] }>(
  row: T
): Promise<T> {
  const creator_avatar = await resolveUrl(row.creator_avatar);
  const media = row.media
    ? await Promise.all(row.media.map(async (m) => ({ ...m, url: (await resolveUrl(m.url)) ?? m.url })))
    : row.media;
  return { ...row, creator_avatar, media };
}

export async function signPostRows<T extends WithCreatorAvatar>(rows: T[]): Promise<T[]> {
  return Promise.all(
    rows.map(async (r) => ({ ...r, creator_avatar: await resolveUrl(r.creator_avatar) }))
  );
}

/** Sign actor_avatar in a notification row. */
export async function signNotificationRow<T extends WithActorAvatar>(row: T): Promise<T> {
  return { ...row, actor_avatar: await resolveUrl(row.actor_avatar) };
}

/** Sign sender_avatar in a message row. */
export async function signMessageRow<T extends WithSenderAvatar>(row: T): Promise<T> {
  return { ...row, sender_avatar: await resolveUrl(row.sender_avatar) };
}

/** Sign author_avatar in a comment/reply row. */
export async function signCommentRow<T extends WithAuthorAvatar>(row: T): Promise<T> {
  return { ...row, author_avatar: await resolveUrl(row.author_avatar) };
}
