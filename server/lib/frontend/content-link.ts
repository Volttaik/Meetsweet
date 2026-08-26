/**
 * Shared logic for MeetSweet content deep-link pages.
 *
 * These pages exist for DIRECT content links (creator / post / album / video /
 * short) — distinct from share-token links (/s/:token). When the app is
 * installed, the OS hands the link to the app (custom scheme on the fallback
 * path; universal/app links intercept the HTTPS URL first); when it is not,
 * the page falls back to the install card. The custom-scheme target below is
 * the SAME path the app's expo-router routes match, so
 * `meetsweet://creator/:id` → app/creator/[id].tsx, and so on.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, media, posts, profiles, users } from "@/lib/db/schema";

export type ContentLinkType = "creator" | "post" | "video" | "short" | "album";

export interface ContentLinkPreview {
  title: string | null;
  description: string | null;
  authorName: string | null;
  imageUrl: string | null;
}

export const CONTENT_LINK_META: Record<
  ContentLinkType,
  { label: string; description: string; icon: string }
> = {
  post: { label: "Post", description: "a post", icon: "✦" },
  video: { label: "Video", description: "a video", icon: "▶" },
  short: { label: "Short", description: "a short", icon: "◒" },
  album: { label: "Album", description: "an album", icon: "▧" },
  creator: { label: "Creator", description: "a creator profile", icon: "◉" },
};

/** The custom-scheme target the app's router matches (path == app route). */
export function contentDeepLink(type: ContentLinkType, id: string): string {
  return `meetsweet://${type}/${id}`;
}

/** Load the preview metadata for a direct content link, or null if it is gone. */
export async function resolveContentLink(
  type: ContentLinkType,
  id: string,
): Promise<ContentLinkPreview | null> {
  try {
    if (type === "creator") {
      const [creator] = await db
        .select({
          title: profiles.display_name,
          description: profiles.bio,
          imageUrl: profiles.avatar_url,
          username: users.username,
        })
        .from(users)
        .leftJoin(profiles, eq(profiles.user_id, users.id))
        .where(
          and(
            eq(users.id, id),
            eq(users.is_active, true),
            isNull(users.deleted_at),
          ),
        )
        .limit(1);
      return creator
        ? {
            title: creator.title ?? (creator.username ? `@${creator.username}` : null),
            description: creator.description ?? null,
            authorName: creator.username ? `@${creator.username}` : null,
            imageUrl: creator.imageUrl ?? null,
          }
        : null;
    }

    if (type === "album") {
      const [album] = await db
        .select({
          title: albums.title,
          description: albums.description,
          imageUrl: albums.cover_url,
          creator_name: profiles.display_name,
          username: users.username,
        })
        .from(albums)
        .innerJoin(users, eq(users.id, albums.creator_id))
        .leftJoin(profiles, eq(profiles.user_id, albums.creator_id))
        .where(
          and(
            eq(albums.id, id),
            isNull(albums.deleted_at),
            eq(users.is_active, true),
            isNull(users.deleted_at),
          ),
        )
        .limit(1);
      return album
        ? {
            title: album.title,
            description: album.description,
            authorName: album.creator_name ?? (album.username ? `@${album.username}` : null),
            imageUrl: album.imageUrl ?? null,
          }
        : null;
    }

    // post / video / short all live in the posts table.
    const [post] = await db
      .select({
        title: posts.title,
        caption: posts.caption,
        description: posts.description,
        thumbnail_url: posts.thumbnail_url,
        content_type: posts.content_type,
        creator_name: profiles.display_name,
        username: users.username,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.creator_id))
      .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
      .where(
        and(
          eq(posts.id, id),
          eq(posts.content_type, type === "post" ? "post" : type === "video" ? "video" : "short"),
          eq(posts.status, "published"),
          isNull(posts.deleted_at),
          eq(users.is_active, true),
          isNull(users.deleted_at),
        ),
      )
      .limit(1);
    if (!post) return null;

    const [asset] = await db
      .select({ url: media.url, thumbnail_url: media.thumbnail_url, type: media.type })
      .from(media)
      .where(eq(media.post_id, id))
      .orderBy(asc(media.sort_order))
      .limit(1);

    return {
      title: post.title ?? null,
      description: post.caption ?? post.description ?? null,
      authorName: post.creator_name ?? (post.username ? `@${post.username}` : null),
      imageUrl:
        post.thumbnail_url ??
        (asset?.type === "image" ? asset.url : asset?.thumbnail_url) ??
        null,
    };
  } catch {
    return null;
  }
}
