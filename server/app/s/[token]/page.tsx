import type { Metadata } from "next";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, media, posts, profiles, shares, users } from "@/lib/db/schema";
import { ContentLinkShell, ContentLinkNotFound } from "@/app/link-shell";

type ContentType = "post" | "video" | "short" | "album" | "creator";

type ShareData = {
  content_type: ContentType;
  content_id: string;
  token: string;
  expires_at?: string | null;
};

type PreviewData = {
  title: string | null;
  description: string | null;
  authorName: string | null;
  imageUrl: string | null;
};

const CONTENT_META: Record<ContentType, { label: string; description: string; icon: string }> = {
  post: { label: "Post", description: "a post", icon: "✦" },
  video: { label: "Video", description: "a video", icon: "▶" },
  short: { label: "Short", description: "a short", icon: "◒" },
  album: { label: "Album", description: "an album", icon: "▧" },
  creator: { label: "Creator", description: "a creator profile", icon: "◉" },
};

async function resolveShare(token: string): Promise<ShareData | null> {
  try {
    const now = new Date().toISOString();
    const [share] = await db
      .select({
        content_type: shares.content_type,
        content_id: shares.content_id,
        token: shares.token,
        expires_at: shares.expires_at,
      })
      .from(shares)
      .where(and(
        eq(shares.token, token),
        or(isNull(shares.expires_at), gt(shares.expires_at, now)),
      ))
      .limit(1);
    if (!share || !["post", "video", "short", "album", "creator"].includes(share.content_type)) {
      return null;
    }
    return { ...share, content_type: share.content_type as ContentType };
  } catch {
    return null;
  }
}

async function loadPreview(share: ShareData): Promise<PreviewData | null> {
  try {
    if (share.content_type === "post" || share.content_type === "video" || share.content_type === "short") {
      const [post] = await db
        .select({
          title: posts.title,
          caption: posts.caption,
          description: posts.description,
          thumbnail_url: posts.thumbnail_url,
          creator_name: profiles.display_name,
          username: users.username,
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.creator_id))
        .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
        .where(and(eq(posts.id, share.content_id), eq(posts.status, "published"), isNull(posts.deleted_at), eq(users.is_active, true), isNull(users.deleted_at)))
        .limit(1);

      if (!post) return null;
      const [asset] = await db
        .select({ url: media.url, thumbnail_url: media.thumbnail_url, type: media.type })
        .from(media)
        .where(eq(media.post_id, share.content_id))
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
    }

    if (share.content_type === "album") {
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
        .where(and(eq(albums.id, share.content_id), isNull(albums.deleted_at), eq(users.is_active, true), isNull(users.deleted_at)))
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

    const [creator] = await db
      .select({
        title: profiles.display_name,
        description: profiles.bio,
        imageUrl: profiles.avatar_url,
        username: users.username,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.user_id, users.id))
      .where(and(eq(users.id, share.content_id), eq(users.is_active, true), isNull(users.deleted_at)))
      .limit(1);

    return creator
      ? {
          title: creator.title ?? (creator.username ? `@${creator.username}` : null),
          description: creator.description ?? null,
          authorName: creator.username ? `@${creator.username}` : null,
          imageUrl: creator.imageUrl ?? null,
        }
      : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await resolveShare(token);

  if (!share) {
    return {
      title: "Link not found — MeetSweet",
      description: "This MeetSweet link has expired or no longer exists.",
    };
  }

  const meta = CONTENT_META[share.content_type] ?? CONTENT_META.post;
  const preview = await loadPreview(share);
  const title = preview?.title ?? `MeetSweet ${meta.label}`;
  const description =
    preview?.description?.slice(0, 160) ?? `Open this ${meta.label.toLowerCase()} in the MeetSweet app.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "MeetSweet",
      type: "website",
      ...(preview?.imageUrl ? { images: [{ url: preview.imageUrl }] } : {}),
    },
    twitter: {
      card: preview?.imageUrl ? "summary_large_image" : "summary",
      title,
      description,
      ...(preview?.imageUrl ? { images: [preview.imageUrl] } : {}),
    },
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await resolveShare(token);

  if (!share) return <ContentLinkNotFound />;

  const meta = CONTENT_META[share.content_type] ?? CONTENT_META.post;
  const preview = await loadPreview(share);

  // Deep link URI — the OS hands this off to the app if installed.
  // The client component fires it automatically on mount; this page is only
  // visible if the app is not installed (or on desktop).
  const deepLink = `meetsweet://s/${token}`;

  return <ContentLinkShell deepLink={deepLink} meta={meta} preview={preview} />;
}
