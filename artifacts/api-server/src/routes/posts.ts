import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { query, queryOne, queryRaw } from "../lib/db.js";
import { requireAuth, optionalAuth, type AuthRequest } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

function formatPost(
  post: Record<string, unknown>,
  author: Record<string, unknown>,
  likedByMe = false,
  bookmarkedByMe = false,
) {
  return {
    id: post.id,
    caption: post.caption,
    visibility: post.visibility,
    mediaUrl: post.media_url ?? null,
    mediaType: post.media_type ?? null,
    thumbnailUrl: post.thumbnail_url ?? null,
    durationSecs: post.duration_secs ?? null,
    fileSize: post.file_size ?? null,
    width: post.width ?? null,
    height: post.height ?? null,
    likeCount: post.like_count ?? 0,
    commentCount: post.comment_count ?? 0,
    bookmarkCount: post.bookmark_count ?? 0,
    isPremium: post.is_premium ?? false,
    priceCredits: post.price_credits ?? null,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    author: {
      id: author.id,
      name: author.name,
      username: author.username,
      avatarUrl: author.avatar_url ?? null,
      isVerified: author.is_verified ?? false,
      isCreator: author.is_creator ?? false,
    },
    likedByMe,
    bookmarkedByMe,
  };
}

// ─── GET /api/posts — public feed ─────────────────────────────────────────────

router.get("/posts", optionalAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(String(req.query.page ?? "1"), 10);
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), 50);
    const offset = (page - 1) * limit;
    const userId = req.query.userId as string | undefined;
    const bookmarked = req.query.bookmarked === "true";

    let whereClause: string;
    const params: unknown[] = [limit, offset];
    let paramIdx = 3;

    if (bookmarked && req.user) {
      whereClause = `p.id IN (SELECT post_id FROM bookmarks WHERE user_id = $${paramIdx++})`;
      params.push(req.user.sub);
    } else if (userId) {
      whereClause = `p.user_id = $${paramIdx++}`;
      params.push(userId);
    } else {
      whereClause = "p.visibility = 'public'";
    }

    const posts = await query<Record<string, unknown>>(
      `SELECT p.*, 
              u.name, u.username, u.avatar_url, u.is_verified, u.is_creator
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    );

    // Get liked + bookmarked post IDs for current user
    const likedSet = new Set<string>();
    const bookmarkedSet = new Set<string>();
    if (req.user && posts.length > 0) {
      const postIds = posts.map((p) => p.id as string);
      const [liked, saved] = await Promise.all([
        query<{ post_id: string }>(
          `SELECT post_id FROM likes WHERE user_id = $1 AND post_id = ANY($2::uuid[])`,
          [req.user.sub, postIds],
        ),
        query<{ post_id: string }>(
          `SELECT post_id FROM bookmarks WHERE user_id = $1 AND post_id = ANY($2::uuid[])`,
          [req.user.sub, postIds],
        ),
      ]);
      liked.forEach((l) => likedSet.add(l.post_id));
      saved.forEach((b) => bookmarkedSet.add(b.post_id));
    }

    const formatted = posts.map((p) =>
      formatPost(
        p,
        { id: p.user_id, name: p.name, username: p.username, avatar_url: p.avatar_url, is_verified: p.is_verified, is_creator: p.is_creator },
        likedSet.has(p.id as string),
        bookmarkedSet.has(p.id as string),
      ),
    );

    res.json({
      posts: formatted,
      page,
      hasMore: posts.length === limit,
    });
  } catch (err) {
    console.error("Get posts error:", err);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// ─── GET /api/posts/:id ───────────────────────────────────────────────────────

router.get("/posts/:id", optionalAuth, async (req: AuthRequest, res) => {
  try {
    const post = await queryOne<Record<string, unknown>>(
      `SELECT p.*, u.name, u.username, u.avatar_url, u.is_verified, u.is_creator
       FROM posts p JOIN users u ON p.user_id = u.id
       WHERE p.id = $1`,
      [req.params.id],
    );

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    let likedByMe = false;
    if (req.user) {
      const liked = await queryOne(
        `SELECT id FROM likes WHERE user_id = $1 AND post_id = $2`,
        [req.user.sub, post.id],
      );
      likedByMe = !!liked;
    }

    res.json({
      post: formatPost(
        post,
        { id: post.user_id, name: post.name, username: post.username, avatar_url: post.avatar_url, is_verified: post.is_verified, is_creator: post.is_creator },
        likedByMe,
      ),
    });
  } catch (err) {
    console.error("Get post error:", err);
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

// ─── POST /api/posts ──────────────────────────────────────────────────────────

router.post("/posts", requireAuth, async (req: AuthRequest, res) => {
  try {
    const {
      caption,
      visibility = "public",
      mediaUrl,
      mediaType,
      thumbnailUrl,
      durationSecs,
      fileSize,
      width,
      height,
      isPremium = false,
      priceCredits,
      categories,
      tags,
    } = req.body as {
      caption?: string;
      visibility?: string;
      mediaUrl?: string;
      mediaType?: string;
      thumbnailUrl?: string;
      durationSecs?: number;
      fileSize?: number;
      width?: number;
      height?: number;
      isPremium?: boolean;
      priceCredits?: number;
      categories?: string[];
      tags?: string[];
    };

    if (!["public", "subscribers", "draft"].includes(visibility)) {
      res.status(400).json({ error: "Invalid visibility" });
      return;
    }

    const postId = uuidv4();

    const [post] = await query<Record<string, unknown>>(
      `INSERT INTO posts (id, user_id, caption, visibility, media_url, media_type, thumbnail_url, duration_secs, file_size, width, height, is_premium, price_credits)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        postId,
        req.user!.sub,
        caption ?? "",
        visibility,
        mediaUrl ?? null,
        mediaType ?? null,
        thumbnailUrl ?? null,
        durationSecs ?? null,
        fileSize ?? null,
        width ?? null,
        height ?? null,
        isPremium,
        priceCredits ?? null,
      ],
    );

    // Insert categories
    if (categories && categories.length > 0) {
      for (const catId of categories) {
        await query(
          `INSERT INTO post_categories (post_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [postId, catId],
        );
        await query(
          `UPDATE categories SET post_count = post_count + 1 WHERE id = $1`,
          [catId],
        );
      }
    }

    // Insert tags
    if (tags && tags.length > 0) {
      for (const tag of tags) {
        await query(
          `INSERT INTO post_tags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [postId, tag.toLowerCase().trim()],
        );
      }
    }

    // Update user post count
    await query(`UPDATE users SET post_count = post_count + 1 WHERE id = $1`, [req.user!.sub]);

    // Fetch author
    const author = await queryOne<Record<string, unknown>>(
      `SELECT id, name, username, avatar_url, is_verified, is_creator FROM users WHERE id = $1`,
      [req.user!.sub],
    );

    res.status(201).json({ post: formatPost(post, author!) });
  } catch (err) {
    console.error("Create post error:", err);
    res.status(500).json({ error: "Failed to create post" });
  }
});

// ─── DELETE /api/posts/:id ────────────────────────────────────────────────────

router.delete("/posts/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const post = await queryOne<Record<string, unknown>>(
      `SELECT id, user_id FROM posts WHERE id = $1`,
      [req.params.id],
    );

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    if (post.user_id !== req.user!.sub) {
      res.status(403).json({ error: "Not your post" });
      return;
    }

    await query(`DELETE FROM posts WHERE id = $1`, [req.params.id]);
    await query(`UPDATE users SET post_count = GREATEST(0, post_count - 1) WHERE id = $1`, [req.user!.sub]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete post error:", err);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

// ─── POST /api/posts/:id/like ─────────────────────────────────────────────────

router.post("/posts/:id/like", requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user!.sub;

    // Insert — ON CONFLICT DO NOTHING; rowCount tells us if it was new
    const insertResult = await queryRaw(
      `INSERT INTO likes (id, user_id, post_id) VALUES (gen_random_uuid(), $1, $2) ON CONFLICT (user_id, post_id) DO NOTHING`,
      [userId, postId],
    );

    // Only increment counter if we actually inserted a new like
    if ((insertResult.rowCount ?? 0) > 0) {
      await queryRaw(`UPDATE posts SET like_count = like_count + 1 WHERE id = $1`, [postId]);

      // Notify post author (fire-and-forget)
      queryOne<{ user_id: string; caption: string }>(
        `SELECT user_id, caption FROM posts WHERE id = $1`,
        [postId],
      ).then(async (post) => {
        if (post && post.user_id !== userId) {
          const actor = await queryOne<{ name: string }>(
            `SELECT name FROM users WHERE id = $1`,
            [userId],
          );
          await queryRaw(
            `INSERT INTO notifications (user_id, type, title, body, actor_id, post_id)
             VALUES ($1, 'like', $2, $3, $4, $5)`,
            [
              post.user_id,
              "New like",
              `${actor?.name ?? "Someone"} liked your post`,
              userId,
              postId,
            ],
          );
        }
      }).catch(() => {});
    }

    const post = await queryOne<{ like_count: number }>(`SELECT like_count FROM posts WHERE id = $1`, [postId]);
    res.json({ liked: true, likeCount: post?.like_count ?? 0 });
  } catch (err) {
    console.error("Like error:", err);
    res.status(500).json({ error: "Failed to like post" });
  }
});

// ─── DELETE /api/posts/:id/like ───────────────────────────────────────────────

router.delete("/posts/:id/like", requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user!.sub;

    const deleteResult = await queryRaw(
      `DELETE FROM likes WHERE user_id = $1 AND post_id = $2`,
      [userId, postId],
    );

    if ((deleteResult.rowCount ?? 0) > 0) {
      await queryRaw(
        `UPDATE posts SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`,
        [postId],
      );
    }

    const post = await queryOne<{ like_count: number }>(`SELECT like_count FROM posts WHERE id = $1`, [postId]);
    res.json({ liked: false, likeCount: post?.like_count ?? 0 });
  } catch (err) {
    console.error("Unlike error:", err);
    res.status(500).json({ error: "Failed to unlike post" });
  }
});

// ─── GET /api/posts/:id/comments ─────────────────────────────────────────────

router.get("/posts/:id/comments", optionalAuth, async (req: AuthRequest, res) => {
  try {
    const parentId = req.query.parentId as string | undefined;
    const limit = parentId ? 50 : 100;

    let whereClause: string;
    let params: unknown[];

    if (parentId) {
      whereClause = `c.post_id = $1 AND c.parent_id = $2`;
      params = [req.params.id, parentId];
    } else {
      whereClause = `c.post_id = $1 AND c.parent_id IS NULL`;
      params = [req.params.id];
    }

    const comments = await query<Record<string, unknown>>(
      `SELECT c.id, c.body, c.like_count, c.created_at, c.updated_at, c.parent_id,
              u.id as user_id, u.name, u.username, u.avatar_url,
              (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id) as reply_count
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE ${whereClause}
       ORDER BY c.created_at ASC
       LIMIT ${limit}`,
      params,
    );

    // Get liked comment IDs for current user
    const likedSet = new Set<string>();
    if (req.user && comments.length > 0) {
      const commentIds = comments.map((c) => c.id as string);
      const liked = await query<{ comment_id: string }>(
        `SELECT comment_id FROM comment_likes WHERE user_id = $1 AND comment_id = ANY($2::uuid[])`,
        [req.user.sub, commentIds],
      );
      liked.forEach((l) => likedSet.add(l.comment_id));
    }

    res.json({
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        likeCount: c.like_count ?? 0,
        replyCount: Number(c.reply_count ?? 0),
        parentId: c.parent_id ?? null,
        likedByMe: likedSet.has(c.id as string),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        author: {
          id: c.user_id,
          name: c.name,
          username: c.username,
          avatarUrl: c.avatar_url ?? null,
        },
      })),
    });
  } catch (err) {
    console.error("Get comments error:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// ─── POST /api/posts/:id/comments ────────────────────────────────────────────

router.post("/posts/:id/comments", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { body, parentId } = req.body as { body: string; parentId?: string };
    if (!body?.trim()) {
      res.status(400).json({ error: "Comment body required" });
      return;
    }

    // Validate parent comment if provided
    if (parentId) {
      const parent = await queryOne(
        `SELECT id FROM comments WHERE id = $1 AND post_id = $2`,
        [parentId, req.params.id],
      );
      if (!parent) {
        res.status(404).json({ error: "Parent comment not found" });
        return;
      }
    }

    const commentId = uuidv4();
    const [comment] = await query<Record<string, unknown>>(
      `INSERT INTO comments (id, user_id, post_id, body, parent_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [commentId, req.user!.sub, req.params.id, body.trim(), parentId ?? null],
    );

    // Only increment post comment_count for top-level comments
    if (!parentId) {
      await query(`UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`, [req.params.id]);
    }

    const author = await queryOne<Record<string, unknown>>(
      `SELECT id, name, username, avatar_url FROM users WHERE id = $1`,
      [req.user!.sub],
    );

    res.status(201).json({
      comment: {
        id: comment.id,
        body: comment.body,
        likeCount: 0,
        replyCount: 0,
        parentId: comment.parent_id ?? null,
        likedByMe: false,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        author: {
          id: author!.id,
          name: author!.name,
          username: author!.username,
          avatarUrl: author!.avatar_url ?? null,
        },
      },
    });
  } catch (err) {
    console.error("Create comment error:", err);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// ─── PUT /api/posts/:id/comments/:commentId — edit comment ────────────────────

router.put("/posts/:id/comments/:commentId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const comment = await queryOne<Record<string, unknown>>(
      `SELECT id, user_id FROM comments WHERE id = $1 AND post_id = $2`,
      [req.params.commentId, req.params.id],
    );

    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    if (comment.user_id !== req.user!.sub) {
      res.status(403).json({ error: "Not your comment" });
      return;
    }

    const { body } = req.body as { body: string };
    if (!body?.trim()) {
      res.status(400).json({ error: "Comment body required" });
      return;
    }

    await queryRaw(
      `UPDATE comments SET body = $1, updated_at = NOW() WHERE id = $2`,
      [body.trim(), req.params.commentId],
    );

    res.json({
      comment: {
        id: comment.id,
        body: body.trim(),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Edit comment error:", err);
    res.status(500).json({ error: "Failed to edit comment" });
  }
});

// ─── DELETE /api/posts/:id/comments/:commentId ────────────────────────────────

router.delete("/posts/:id/comments/:commentId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const comment = await queryOne<Record<string, unknown>>(
      `SELECT id, user_id FROM comments WHERE id = $1 AND post_id = $2`,
      [req.params.commentId, req.params.id],
    );

    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    if (comment.user_id !== req.user!.sub) {
      res.status(403).json({ error: "Not your comment" });
      return;
    }

    await query(`DELETE FROM comments WHERE id = $1`, [req.params.commentId]);
    await query(`UPDATE posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = $1`, [req.params.id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete comment error:", err);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

// ─── POST /api/posts/:id/comments/:commentId/like ─────────────────────────────

router.post("/posts/:id/comments/:commentId/like", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user!.sub;
    const result = await queryRaw(
      `INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, commentId],
    );
    if ((result.rowCount ?? 0) > 0) {
      await queryRaw(`UPDATE comments SET like_count = like_count + 1 WHERE id = $1`, [commentId]);
    }
    const c = await queryOne<{ like_count: number }>(`SELECT like_count FROM comments WHERE id = $1`, [commentId]);
    res.json({ liked: true, likeCount: c?.like_count ?? 0 });
  } catch (err) {
    console.error("Like comment error:", err);
    res.status(500).json({ error: "Failed to like comment" });
  }
});

// ─── DELETE /api/posts/:id/comments/:commentId/like ───────────────────────────

router.delete("/posts/:id/comments/:commentId/like", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user!.sub;
    const result = await queryRaw(
      `DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2`,
      [userId, commentId],
    );
    if ((result.rowCount ?? 0) > 0) {
      await queryRaw(`UPDATE comments SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [commentId]);
    }
    const c = await queryOne<{ like_count: number }>(`SELECT like_count FROM comments WHERE id = $1`, [commentId]);
    res.json({ liked: false, likeCount: c?.like_count ?? 0 });
  } catch (err) {
    console.error("Unlike comment error:", err);
    res.status(500).json({ error: "Failed to unlike comment" });
  }
});

// ─── PUT /api/posts/:id — edit post ──────────────────────────────────────────

router.put("/posts/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const post = await queryOne<Record<string, unknown>>(
      `SELECT id, user_id FROM posts WHERE id = $1`,
      [req.params.id],
    );
    if (!post) { res.status(404).json({ error: "Post not found" }); return; }
    if (post.user_id !== req.user!.sub) { res.status(403).json({ error: "Not your post" }); return; }

    const { caption, visibility } = req.body as { caption?: string; visibility?: string };
    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (caption !== undefined) { updates.push(`caption = $${idx++}`); params.push(caption); }
    if (visibility !== undefined && ["public","subscribers","draft"].includes(visibility)) {
      updates.push(`visibility = $${idx++}`);
      params.push(visibility);
    }
    if (updates.length === 0) { res.json({ success: true }); return; }

    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    await queryRaw(`UPDATE posts SET ${updates.join(", ")} WHERE id = $${idx}`, params);
    res.json({ success: true });
  } catch (err) {
    console.error("Edit post error:", err);
    res.status(500).json({ error: "Failed to edit post" });
  }
});

// ─── POST /api/posts/:id/bookmark ─────────────────────────────────────────────

router.post("/posts/:id/bookmark", requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user!.sub;
    const result = await queryRaw(
      `INSERT INTO bookmarks (id, user_id, post_id) VALUES (gen_random_uuid(), $1, $2) ON CONFLICT (user_id, post_id) DO NOTHING`,
      [userId, postId],
    );
    if ((result.rowCount ?? 0) > 0) {
      await queryRaw(`UPDATE posts SET bookmark_count = bookmark_count + 1 WHERE id = $1`, [postId]);
    }
    res.json({ bookmarked: true });
  } catch (err) {
    console.error("Bookmark error:", err);
    res.status(500).json({ error: "Failed to bookmark post" });
  }
});

// ─── DELETE /api/posts/:id/bookmark ──────────────────────────────────────────

router.delete("/posts/:id/bookmark", requireAuth, async (req: AuthRequest, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user!.sub;
    const result = await queryRaw(
      `DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2`,
      [userId, postId],
    );
    if ((result.rowCount ?? 0) > 0) {
      await queryRaw(`UPDATE posts SET bookmark_count = GREATEST(0, bookmark_count - 1) WHERE id = $1`, [postId]);
    }
    res.json({ bookmarked: false });
  } catch (err) {
    console.error("Unbookmark error:", err);
    res.status(500).json({ error: "Failed to remove bookmark" });
  }
});

export default router;
