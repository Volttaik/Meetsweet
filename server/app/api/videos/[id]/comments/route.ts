import { NextRequest } from "next/server";
import { eq, and, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts, comments, users, profiles } from "@/lib/db/schema";
import { optionalAuth, requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { buildComment } from "@/lib/services/content";

const createSchema = z.object({ body: z.string().min(1).max(2000) });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);
  const userId = (await optionalAuth(req))?.userId ?? null;

  const [post] = await db.select({ id: posts.id }).from(posts)
    .where(and(eq(posts.id, id), eq(posts.content_type, "video"))).limit(1);
  if (!post) return err("Video not found", 404);

  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      is_pinned: comments.is_pinned,
      like_count: comments.like_count,
      reply_count: comments.reply_count,
      created_at: comments.created_at,
      author_id: users.id,
      author_name: users.full_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
      author_is_verified: users.is_verified,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comments.author_id))
    .where(and(eq(comments.post_id, id), isNull(comments.deleted_at)))
    .orderBy(desc(comments.is_pinned), desc(comments.created_at))
    .limit(limit);

  return ok({ comments: rows.map((r) => buildComment(r, userId)) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const [post] = await db.select({ id: posts.id, comment_count: posts.comment_count })
    .from(posts).where(and(eq(posts.id, id), eq(posts.content_type, "video"))).limit(1);
  if (!post) return err("Video not found", 404);

  const parsed = await parseBody(req, createSchema);
  if (!parsed.success) return parsed.response;

  const commentId = generateId();
  await db.insert(comments).values({
    id: commentId,
    post_id: id,
    author_id: auth.user.userId,
    body: parsed.data.body,
  });

  const [profile] = await db.select({ avatar_url: profiles.avatar_url }).from(profiles)
    .where(eq(profiles.user_id, auth.user.userId)).limit(1);

  const comment = {
    id: commentId,
    body: parsed.data.body,
    like_count: 0,
    reply_count: 0,
    is_pinned: false,
    created_at: new Date().toISOString(),
    author: {
      id: auth.user.userId,
      name: auth.user.username,
      username: auth.user.username,
      avatarUrl: profile?.avatar_url ?? null,
      isVerified: false,
    },
  };

  return created({ comment });
}
