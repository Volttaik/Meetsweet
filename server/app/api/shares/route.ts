import { NextRequest } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts, albums, users, shares } from "@/lib/db/schema";
import { optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { config } from "@/lib/config";

const createSchema = z.object({
  content_type: z.enum(["post", "video", "short", "album", "creator"]),
  content_id: z.string().min(1),
});

function generateShareToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 12; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function getBaseUrl(req: NextRequest): string {
  const appUrl = config.app.url();
  if (appUrl) return appUrl;
  const host = req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "https://meetsweet.app";
}

export async function POST(req: NextRequest) {
  const userId = (await optionalAuth(req))?.userId ?? null;

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;
  const { content_type, content_id } = parsed.data;

  // Verify the content exists
  switch (content_type) {
    case "post":
    case "video":
    case "short": {
      const [post] = await db.select({ id: posts.id }).from(posts)
        .where(and(eq(posts.id, content_id), eq(posts.status, "published")))
        .limit(1);
      if (!post) return err("Content not found", 404);
      // Increment share count
      await db.update(posts)
        .set({ share_count: sql`${posts.share_count} + 1` })
        .where(eq(posts.id, content_id));
      break;
    }
    case "album": {
      const [album] = await db.select({ id: albums.id }).from(albums)
        .where(eq(albums.id, content_id)).limit(1);
      if (!album) return err("Album not found", 404);
      break;
    }
    case "creator": {
      const [creator] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, content_id), eq(users.is_creator, true))).limit(1);
      if (!creator) return err("Creator not found", 404);
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

  const baseUrl = getBaseUrl(req);
  const url = `${baseUrl}/s/${token}`;

  return created({ token, url, share_url: url, expires_at: expiresAt });
}
