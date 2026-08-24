/**
 * Link Preview Service — resolve a URL pasted into chat into structured,
 * human-readable metadata so the client can render a rich preview card.
 *
 * Two families of links:
 *   • MeetSweet internal links (share tokens / profile / post / album / short)
 *     → resolved from the database into names, usernames, titles and
 *       thumbnails. Never exposes raw internal ids as the primary label.
 *   • External links → the page's OpenGraph / Twitter Card / <title> metadata
 *     is fetched once and cached; when no metadata is available the domain is
 *     returned so the client still renders a clean clickable URL.
 *
 * Caching: resolution is cached in-memory (TTL + size capped) so the same URL
 * is never fetched again on every chat open — the resolved preview is also
 * persisted on the chat message itself by the caller, so history renders
 * immediately without any re-fetch.
 */
import { and, eq, isNull, or, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, chat_room_messages, posts, profiles, shares, users } from "@/lib/db/schema";
import { config } from "@/lib/config";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LinkPreviewKind = "profile" | "post" | "album" | "short" | "video" | "external";

export interface LinkPreview {
  /** The original URL that was shared. */
  url: string;
  kind: LinkPreviewKind;
  /** Human-readable labels — NEVER raw database ids as the primary label. */
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  /** Display name + handle for profiles (internal links). */
  name?: string | null;
  username?: string | null;
  /** Domain for external links. */
  domain?: string | null;
  /** Internal routing info (id + type) — kept inside the payload, not shown
   *  as the primary user-facing label. */
  resourceId?: string | null;
  resourceType?: string | null;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — metadata is stable
const CACHE_MAX = 2000;
const cache = new Map<string, { at: number; value: LinkPreview | null }>();

function cacheGet(key: string): LinkPreview | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key: string, value: LinkPreview | null): void {
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest entry (Map preserves insertion order).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  // Custom scheme (meetsweet://s/TOKEN) — keep as-is for internal resolution.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isMeetSweetHost(host: string): boolean {
  const publicHost = hostOf(config.app.publicUrl());
  return (
    host === "meetsweet.space" ||
    host === "meetsweet.app" ||
    (!!publicHost && host === publicHost)
  );
}

// ─── External metadata fetch ──────────────────────────────────────────────────

const OG_TITLE_RE = /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']*)["']/i;
const OG_DESC_RE = /<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']*)["']/i;
const OG_IMAGE_RE = /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']*)["']/i;
const TW_TITLE_RE = /<meta[^>]+(?:property|name)=["']twitter:title["'][^>]+content=["']([^"']*)["']/i;
const TW_DESC_RE = /<meta[^>]+(?:property|name)=["']twitter:description["'][^>]+content=["']([^"']*)["']/i;
const TW_IMAGE_RE = /<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']*)["']/i;
const HTML_TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i;
const META_DESC_RE = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i;

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function first(matches: RegExpExecArray | null): string {
  return matches ? decodeHtml(matches[1]).trim() : "";
}

async function fetchExternalMetadata(url: string): Promise<LinkPreview | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; MeetSweetBot/1.0; +https://meetsweet.space)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(contentType)) return null;
    // Cap the body read — metadata lives in the <head>.
    const html = (await res.text()).slice(0, 300_000);
    const domain = hostOf(url);

    const title = first(OG_TITLE_RE.exec(html)) || first(TW_TITLE_RE.exec(html)) || first(HTML_TITLE_RE.exec(html));
    const description =
      first(OG_DESC_RE.exec(html)) ||
      first(TW_DESC_RE.exec(html)) ||
      first(META_DESC_RE.exec(html));
    const imageUrl = first(OG_IMAGE_RE.exec(html)) || first(TW_IMAGE_RE.exec(html)) || null;

    if (!title && !description && !imageUrl) {
      // Nothing useful — still return a minimal card so the client shows a
      // clean clickable URL with the domain.
      return { url, kind: "external", domain, title: null, description: null, imageUrl: null };
    }
    return { url, kind: "external", domain, title: title || null, description: description || null, imageUrl: imageUrl || null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Internal MeetSweet resolution ────────────────────────────────────────────

const SHARE_PATH_RE = /\/s\/([A-Za-z0-9_-]+)\/?$/;
const PROFILE_PATH_RE = /\/creator\/([^/?#]+)\/?$/;
const POST_PATH_RE = /\/post\/([^/?#]+)\/?$/;
const VIDEO_PATH_RE = /\/videos\/([^/?#]+)\/?$/;
const SHORT_PATH_RE = /\/shorts\/([^/?#]+)\/?$/;
const ALBUM_PATH_RE = /\/album\/([^/?#]+)\/?$/;

async function resolveProfile(idOrUsername: string): Promise<LinkPreview | null> {
  const clean = idOrUsername.replace(/^@/, "");
  // Internal ids are UUIDs (or the legacy `user_`/`usr_`/`creator_` prefixes);
  // a share token for a creator stores the user UUID, so UUID-shaped values
  // are resolved by id. Everything else is treated as a username.
  const isId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean) ||
    /^(user_|usr_|creator_)/i.test(clean);
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      full_name: users.full_name,
      display_name: profiles.display_name,
      avatar_url: profiles.avatar_url,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.user_id, users.id))
    .where(
      and(
        isId ? eq(users.id, clean) : eq(users.username, clean),
        eq(users.is_active, true),
        isNull(users.deleted_at),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    url: "",
    kind: "profile",
    name: row.display_name || row.full_name || row.username,
    username: row.username,
    title: row.display_name || row.full_name || row.username,
    description: null,
    imageUrl: row.avatar_url,
    resourceId: row.id,
    resourceType: "creator",
  };
}

async function resolvePost(id: string): Promise<LinkPreview | null> {
  const [row] = await db
    .select({
      id: posts.id,
      content_type: posts.content_type,
      title: posts.title,
      caption: posts.caption,
      description: posts.description,
      thumbnail_url: posts.thumbnail_url,
      creator_id: posts.creator_id,
      creator_name: users.full_name,
      creator_display: profiles.display_name,
      creator_username: users.username,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, posts.creator_id))
    .where(and(eq(posts.id, id), eq(posts.status, "published"), isNull(posts.deleted_at)))
    .limit(1);
  if (!row) return null;
  const kind: LinkPreviewKind =
    row.content_type === "short" ? "short" : row.content_type === "video" ? "video" : "post";
  const title = row.title || row.caption || `${row.creator_display || row.creator_name || row.creator_username}'s ${kind}`;
  const description = row.description || row.caption || null;
  return {
    url: "",
    kind,
    title,
    description,
    imageUrl: row.thumbnail_url,
    name: row.creator_display || row.creator_name || row.creator_username,
    username: row.creator_username,
    resourceId: row.id,
    resourceType: row.content_type,
  };
}

async function resolveAlbum(id: string): Promise<LinkPreview | null> {
  const [row] = await db
    .select({
      id: albums.id,
      title: albums.title,
      description: albums.description,
      cover_url: albums.cover_url,
      creator_id: albums.creator_id,
      creator_name: users.full_name,
      creator_display: profiles.display_name,
      creator_username: users.username,
    })
    .from(albums)
    .innerJoin(users, eq(users.id, albums.creator_id))
    .leftJoin(profiles, eq(profiles.user_id, albums.creator_id))
    .where(and(eq(albums.id, id), isNull(albums.deleted_at)))
    .limit(1);
  if (!row) return null;
  return {
    url: "",
    kind: "album",
    title: row.title,
    description: row.description || null,
    imageUrl: row.cover_url,
    name: row.creator_display || row.creator_name || row.creator_username,
    username: row.creator_username,
    resourceId: row.id,
    resourceType: "album",
  };
}

async function resolveShareToken(token: string): Promise<LinkPreview | null> {
  const now = new Date().toISOString();
  const [share] = await db
    .select({
      content_type: shares.content_type,
      content_id: shares.content_id,
      expires_at: shares.expires_at,
    })
    .from(shares)
    .where(
      and(
        eq(shares.token, token),
        or(isNull(shares.expires_at), gt(shares.expires_at, now)),
      ),
    )
    .limit(1);
  if (!share) return null;
  switch (share.content_type) {
    case "creator":
      return resolveProfile(share.content_id);
    case "album":
      return resolveAlbum(share.content_id);
    case "post":
    case "video":
    case "short":
    default:
      return resolvePost(share.content_id);
  }
}

async function resolveInternal(url: string): Promise<LinkPreview | null> {
  let path = "";
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
  } catch {
    const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]*)(\/.*)?$/i);
    path = m?.[2] ?? url;
  }

  let preview: LinkPreview | null = null;
  const share = SHARE_PATH_RE.exec(path);
  if (share) preview = await resolveShareToken(share[1]);
  else {
    const profile = PROFILE_PATH_RE.exec(path);
    const post = POST_PATH_RE.exec(path);
    const video = VIDEO_PATH_RE.exec(path);
    const short = SHORT_PATH_RE.exec(path);
    const album = ALBUM_PATH_RE.exec(path);
    if (profile) preview = await resolveProfile(profile[1]);
    else if (post) preview = await resolvePost(post[1]);
    else if (video) preview = await resolvePost(video[1]);
    else if (short) preview = await resolvePost(short[1]);
    else if (album) preview = await resolveAlbum(album[1]);
  }
  if (!preview) {
    // Fall back to @username-at-root share form: meetsweet.space/@handle
    const atMatch = url.match(/(?:^|\/)(@[A-Za-z0-9_.]+)$/);
    if (atMatch) preview = await resolveProfile(atMatch[1]);
  }
  if (preview) preview.url = url;
  return preview;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve a pasted URL into a rich link preview. Never throws — messaging must
 * not break because metadata could not be retrieved. Returns null when the URL
 * is unusable; otherwise at minimum a domain-level external card.
 */
export async function resolveLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  const url = normalizeUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) return null;

  const cacheKey = url;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  let preview: LinkPreview | null = null;
  const host = hostOf(url);
  if (isMeetSweetHost(host) || url.startsWith("meetsweet://")) {
    preview = await resolveInternal(url);
    if (!preview) preview = { url, kind: "external", domain: host, title: null, description: null, imageUrl: null };
  } else {
    preview = await fetchExternalMetadata(url);
  }

  cacheSet(cacheKey, preview);
  return preview;
}

/** Find the first http(s) URL inside a message body, if any. */
export function findFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;!?]+$/, "") : null;
}

/**
 * Resolve the preview for a message body and persist it on the message row.
 * Returns the preview (or null) WITHOUT throwing — a failed resolution must
 * never break the message. The caller broadcasts a messages:update so both
 * participants' bubbles gain the card the moment metadata is available.
 */
export async function resolveAndPersistLinkPreview(
  messageId: string,
  body: string | null | undefined,
): Promise<LinkPreview | null> {
  const url = findFirstUrl(body);
  if (!url) return null;
  const preview = await resolveLinkPreview(url);
  if (!preview) return null;
  try {
    await db
      .update(chat_room_messages)
      .set({ link_preview: JSON.stringify(preview) })
      .where(eq(chat_room_messages.id, messageId));
  } catch {
    // Persistence of the preview is best-effort; the event still carries it.
  }
  return preview;
}
