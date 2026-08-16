import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  comment_replies,
  comments,
  notifications,
  posts,
  profiles,
  users,
} from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { listRoomComments, commentShape, ensureCommentRoom } from "@/lib/services/comment-rooms";
import { sendPushToUser, getActorUsername } from "@/lib/services/push";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const after = req.nextUrl.searchParams.get("after") ?? undefined;

  const viewer = await optionalAuth(req);
  const commentsList = await listRoomComments(id, { after, viewerId: viewer?.userId ?? null });

  return ok({ comments: commentsList, has_more: false, hasMore: false });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [post] = await db
    .select({ id: posts.id, creator_id: posts.creator_id, content_type: posts.content_type })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!post) return err("Post not found", 404);

  const room = await ensureCommentRoom(id);
  if (room && !room.comments_enabled) {
    return err("Comments are disabled for this post", 403, "COMMENTS_DISABLED");
  }

  const parsed = await parseBody(
    req,
    z.object({
      body: z.string().min(1).max(1000),
      parent_id: z.string().optional(),
      parentId: z.string().optional(),
    }),
  );
  if (!parsed.success) return parsed.response;

  const parentId = parsed.data.parent_id ?? parsed.data.parentId ?? null;

  // Threaded reply
  if (parentId) {
    const [parent] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.id, parentId))
      .limit(1);
    if (!parent) return err("Parent comment not found", 404);

    const replyId = generateId();
    await db.insert(comment_replies).values({
      id: replyId,
      comment_id: parentId,
      author_id: auth.user.userId,
      body: parsed.data.body,
    });
    await db.update(comments).set({ reply_count: sql`${comments.reply_count} + 1` }).where(eq(comments.id, parentId));

    const [row] = await db
      .select({
        id: comment_replies.id,
        body: comment_replies.body,
        like_count: comment_replies.like_count,
        created_at: comment_replies.created_at,
        updated_at: comment_replies.updated_at,
        author_id: users.id,
        author_name: users.full_name,
        author_display_name: profiles.display_name,
        author_username: users.username,
        author_avatar: profiles.avatar_url,
      })
      .from(comment_replies)
      .innerJoin(users, eq(users.id, comment_replies.author_id))
      .leftJoin(profiles, eq(profiles.user_id, comment_replies.author_id))
      .where(eq(comment_replies.id, replyId))
      .limit(1);

    return created({ comment: commentShape(row, id, false, parentId) });
  }

  const commentId = generateId();
  await db.insert(comments).values({
    id: commentId,
    post_id: id,
    author_id: auth.user.userId,
    body: parsed.data.body,
  });
  await db.update(posts).set({ comment_count: sql`${posts.comment_count} + 1` }).where(eq(posts.id, id));

  // Notify the post creator (skip self-comments).
  if (post.creator_id && post.creator_id !== auth.user.userId) {
    await db.insert(notifications).values({
      id: generateId(),
      user_id: post.creator_id,
      actor_id: auth.user.userId,
      type: "comment",
      entity_type: "post",
      entity_id: id,
      body: parsed.data.body.slice(0, 100),
    }).catch(() => {});

    const preview = parsed.data.body.length > 60 ? parsed.data.body.slice(0, 57) + "…" : parsed.data.body;
    getActorUsername(auth.user.userId).then((actor) =>
      sendPushToUser(post.creator_id!, {
        title: "New Comment",
        body: `${actor}: ${preview}`,
        data: {
          type: "comment",
          post_id: id,
          actor_id: auth.user.userId,
          content_type: post.content_type ?? "post",
          actor_username: actor.replace(/^@/, ""),
        },
      }, "notif_comments"),
    );
  }

  const [row] = await db
    .select({
      id: comments.id,
      body: comments.body,
      is_pinned: comments.is_pinned,
      like_count: comments.like_count,
      reply_count: comments.reply_count,
      created_at: comments.created_at,
      updated_at: comments.updated_at,
      author_id: users.id,
      author_name: users.full_name,
      author_display_name: profiles.display_name,
      author_username: users.username,
      author_avatar: profiles.avatar_url,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.author_id))
    .leftJoin(profiles, eq(profiles.user_id, comments.author_id))
    .where(eq(comments.id, commentId))
    .limit(1);

  return created({ comment: commentShape(row, id, false) });
}
