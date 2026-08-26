import { NextRequest } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  comments,
  posts,
  profiles,
  users,
  user_settings,
} from "@/lib/db/schema";
import { requireAuth, optionalAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err, created } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { listRoomComments, commentShape, ensureCommentRoom } from "@/lib/services/comment-rooms";
import { notifyComment, notifyCommentReply, notifyMentionedUsers } from "@/lib/services/notifications";

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
    .select({
      id: posts.id,
      creator_id: posts.creator_id,
      content_type: posts.content_type,
      title: posts.title,
      caption: posts.caption,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!post) return err("Post not found", 404);

  // "Comments OFF" — the post owner disabled commenting on all their posts.
  // Enforced at creation so the toggle is authoritative, never a client filter.
  const [ownerSettings] = await db
    .select({ allow_comments: user_settings.allow_comments })
    .from(user_settings)
    .where(eq(user_settings.user_id, post.creator_id))
    .limit(1);
  if (ownerSettings?.allow_comments === false) {
    return err("Comments are disabled for this post", 403, "COMMENTS_DISABLED");
  }

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

  // Threaded reply — the parent may be a top-level comment OR any deeper
  // reply in the same room. The new row is a comment whose parent_id is the
  // exact target; no depth limit is imposed, and a reply can never become a
  // top-level comment or a child of a later sibling.
  if (parentId) {
    const [parent] = await db
      .select({ id: comments.id, post_id: comments.post_id, author_id: comments.author_id })
      .from(comments)
      .where(and(eq(comments.id, parentId), isNull(comments.deleted_at)))
      .limit(1);
    if (!parent || parent.post_id !== id) return err("Parent comment not found", 404);

    const replyId = generateId();
    await db.insert(comments).values({
      id: replyId,
      post_id: id,
      parent_id: parentId,
      author_id: auth.user.userId,
      body: parsed.data.body,
    });
    await db.update(comments).set({ reply_count: sql`${comments.reply_count} + 1` }).where(eq(comments.id, parentId));

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
      .where(eq(comments.id, replyId))
      .limit(1);

    // A reply notifies the author of the comment it answers (never the
    // replier, and the post owner separately when they are a different user).
    // The service dedupes so retries never double-notify.
    if (parent.author_id !== auth.user.userId) {
      void notifyCommentReply({
        actorId: auth.user.userId,
        parentAuthorId: parent.author_id,
        postId: id,
        contentType: post.content_type ?? "post",
        commentId: parentId,
        commentBody: parsed.data.body,
      });
    }

    // @username tags inside a reply notify the tagged users (gated server-side
    // by their Allow Mentions privacy + Mentions preference).
    void notifyMentionedUsers({
      actorId: auth.user.userId,
      text: parsed.data.body,
      entityType: post.content_type ?? "post",
      entityId: id,
      entityTitle: post.title ?? post.caption,
    });

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

  // Notify the post creator (skip self-comments). The service gates the row +
  // push by their Comments preference, dedupes the event, and builds the
  // navigation payload — never awaited so it can't delay the reply.
  if (post.creator_id && post.creator_id !== auth.user.userId) {
    void notifyComment({
      actorId: auth.user.userId,
      postOwnerId: post.creator_id,
      postId: id,
      contentType: post.content_type ?? "post",
      title: post.title ?? post.caption,
      commentBody: parsed.data.body,
      commentId,
    });
  }

  // @username tags inside a comment notify the tagged users (gated server-side
  // by their Allow Mentions privacy + Mentions notification preference).
  void notifyMentionedUsers({
    actorId: auth.user.userId,
    text: parsed.data.body,
    entityType: post.content_type ?? "post",
    entityId: id,
    entityTitle: post.title ?? post.caption,
  });

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
