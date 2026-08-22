import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { eq, and, sql, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts, albums, users, shares } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { config } from "@/lib/config";
import { emitEvent } from "@/lib/realtime/emit";

const createSchema = z.object({
  content_type: z.enum(["post", "video", "short", "album", "creator"]).optional(),
  // Mobile uses `type` / `target_id`.
  type: z.enum(["post", "video", "short", "album", "creator"]).optional(),
  content_id: z.string().min(1).optional(),
  target_id: z.string().min(1).optional(),
}).transform((d) => ({
  content_type: d.content_type ?? d.type,
  content_id: d.content_id ?? d.target_id,
})).refine((d) => d.content_type && d.content_id, {
  message: "content_type (or type) and content_id (or target_id) are required",
});

function generateShareToken(): string {
  return randomBytes(9).toString("base64url");
}

function getBaseUrl(): string {
  // Share links are public web links, never API-origin links. This also keeps
  // links correct when the API is reached through an old api.meetsweet.space
  // alias or a local proxy.
  return config.app.publicUrl().replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const userId = auth.user.userId;

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;
  const { content_type, content_id } = parsed.data as {
    content_type: "post" | "video" | "short" | "album" | "creator";
    content_id: string;
  };

  // Verify the content exists
  switch (content_type) {
    case "post":
    case "video":
    case "short": {
      const [post] = await db.select({ id: posts.id, creator_id: posts.creator_id, share_count: posts.share_count }).from(posts)
        .where(and(eq(posts.id, content_id), eq(posts.status, "published"), isNull(posts.deleted_at)))
        .limit(1);
      if (!post) return err("Content not found", 404);
      // Increment share count
      await db.update(posts)
        .set({ share_count: sql`${posts.share_count} + 1` })
        .where(eq(posts.id, content_id));
      void emitEvent({
        type: "share:created",
        channel: `post:${content_id}`,
        resourceId: content_id,
        userId,
        payload: {
          postId: content_id,
          creatorId: post.creator_id,
          shareCount: Number(post.share_count ?? 0) + 1,
          shareId: null,
        },
      });
      break;
    }
    case "album": {
      const [album] = await db.select({ id: albums.id }).from(albums)
        .where(and(eq(albums.id, content_id), isNull(albums.deleted_at))).limit(1);
      if (!album) return err("Album not found", 404);
      break;
    }
    case "creator": {
      // A profile share may point at any active user — a creator or a regular
      // fan sharing their own profile. Resolve by the canonical user id.
      const [creator] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, content_id), eq(users.is_active, true), isNull(users.deleted_at))).limit(1);
      if (!creator) return err("User not found", 404);
      break;
    }
  }

  const token = generateShareToken();
  const shareId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.insert(shares).values({
    id: shareId,
    creator_id: userId,
    content_type,
    content_id,
    token,
    expires_at: expiresAt,
  });

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/s/${token}`;

  return created({ token, url, share_url: url, expires_at: expiresAt });
}
