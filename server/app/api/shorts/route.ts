import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts, media, post_categories } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

const createSchema = z.object({
  caption: z.string().max(2200).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  visibility: z.enum(["public", "subscribers", "draft"]).default("public"),
  // Shorts are always public — no tier gating
  thumbnail_url: z.string().url().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  preview_duration: z.number().int().min(1).nullable().optional(),
  media_ids: z.array(z.string()).max(10).optional(),
  media: z
    .array(
      z.object({
        url: z.string().url(),
        blob_path: z.string().min(1),
        type: z.enum(["image", "video"]),
        mime_type: z.string().optional(),
        size_bytes: z.number().int().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        duration_seconds: z.number().optional(),
        thumbnail_url: z.string().url().optional(),
      }),
    )
    .max(10)
    .optional(),
  categories: z.array(z.string()).optional(),
});

/**
 * POST /api/shorts — Create a short-form video.
 * Stores as a posts row with content_type = 'short'.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;

  const {
    caption, title, visibility,
    thumbnail_url, tags,
    preview_duration,
    media_ids, media: mediaItems, categories,
  } = parsed.data;

  const postId = generateId();
  const now = new Date().toISOString();

  await db.insert(posts).values({
    id: postId,
    creator_id: auth.user.userId,
    content_type: "short",
    caption: caption ?? null,
    title: title ?? null,
    thumbnail_url: thumbnail_url ?? null,
    tier: null, // Shorts are always public — no tier gating
    tags: tags && tags.length > 0 ? JSON.stringify(tags) : null,
    visibility: visibility ?? "public",
    status: "published",
    preview_duration: preview_duration ?? null,
    published_at: now,
  });

  if (mediaItems && mediaItems.length > 0) {
    await db.insert(media).values(
      mediaItems.map((m, i) => ({
        id: generateId(),
        post_id: postId,
        uploader_id: auth.user.userId,
        url: m.url,
        blob_path: m.blob_path,
        type: m.type,
        mime_type: m.mime_type ?? null,
        size_bytes: m.size_bytes ?? null,
        width: m.width ?? null,
        height: m.height ?? null,
        duration_seconds: m.duration_seconds ?? null,
        thumbnail_url: m.thumbnail_url ?? null,
        sort_order: i,
      })),
    );
  }

  if (media_ids && media_ids.length > 0) {
    for (let i = 0; i < media_ids.length; i++) {
      await db
        .update(media)
        .set({ post_id: postId, sort_order: i })
        .where(and(eq(media.id, media_ids[i]), eq(media.uploader_id, auth.user.userId)));
    }
  }

  if (categories && categories.length > 0) {
    await db.insert(post_categories).values(
      categories.map((categoryId) => ({
        id: generateId(),
        post_id: postId,
        category_id: categoryId,
      })),
    ).onConflictDoNothing();
  }

  return created({ id: postId });
}
