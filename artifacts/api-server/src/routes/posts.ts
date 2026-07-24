import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { query, queryOne } from "../lib/db.js";
import { requireAuth, optionalAuth, type AuthRequest } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

function formatPost(post: Record<string, unknown>, author: Record<string, unknown>, likedByMe = false) {
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
  };
}

// ─── GET /api/posts — public feed ─────────────────────────────────────────────

router.get("/posts", optionalAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(String(req.query.page ?? "1"), 10);
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), 50);
    const offset = (page - 1) * limit;
    const userId = req.query.userId as string | undefined;

    let whereClause = "p.visibility = 'public'";
    const params: unknown[] = [limit, offset];
    let paramIdx = 3;

    if (userId) {
      whereClause = "p.user_id = $" + paramIdx++;
      params.push(userId);
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

    // Get liked post IDs for current user
    const likedSet = new Set<string>();
    if (req.user && posts.length > 0) {
      const postIds = posts.map((p) => p.id as string);
      const liked = await query<{ post_id: string }>(
        `SELECT post_id FROM likes WHERE user_id = $1 AND post_id = ANY($2::uuid[])`,
        [req.user.sub, postIds],
      );
      liked.forEach((l) => likedSet.add(l.post_id));
    }

    const formatted = posts.map((p) =>
      formatPost(
        p,
        { id: p.user_id, name: p.name, username: p.username, avatar_url: p.avatar_url, is_verified: p.is_verified, is_creator: p.is_creator },
        likedSet.has(p.id as string),
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

    await query(
      `INSERT INTO likes (id, user_id, post_id) VALUES (gen_random_uuid(), $1, $2) ON CONFLICT DO NOTHING`,
      [userId, postId],
    );

    const [updated] = await query<{ like_count: number }>(
      `UPDATE posts SET like_count = like_count + 1 WHERE id = $1 AND NOT EXISTS (
        SELECT 1 FROM likes WHERE user_id = $2 AND post_id = $1
        -- we already inserted above; this handles idempotency via the count
      ) RETURNING like_count`,
      [postId, userId],
    );

    // Just re-fetch the count
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

    const result = await query(
      `DELETE FROM likes WHERE user_id = $1 AND post_id = $2`,
      [userId, postId],
    );

    if ((result as unknown as { rowCount: number }).rowCount > 0) {
      await query(
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

router.get("/posts/:id/comments", async (req, res) => {
  try {
    const comments = await query<Record<string, unknown>>(
      `SELECT c.id, c.body, c.created_at,
              u.id as user_id, u.name, u.username, u.avatar_url
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC
       LIMIT 50`,
      [req.params.id],
    );

    res.json({
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
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
    const { body } = req.body as { body: string };
    if (!body?.trim()) {
      res.status(400).json({ error: "Comment body required" });
      return;
    }

    const commentId = uuidv4();
    const [comment] = await query<Record<string, unknown>>(
      `INSERT INTO comments (id, user_id, post_id, body) VALUES ($1, $2, $3, $4) RETURNING *`,
      [commentId, req.user!.sub, req.params.id, body.trim()],
    );

    await query(`UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`, [req.params.id]);

    const author = await queryOne<Record<string, unknown>>(
      `SELECT id, name, username, avatar_url FROM users WHERE id = $1`,
      [req.user!.sub],
    );

    res.status(201).json({
      comment: {
        id: comment.id,
        body: comment.body,
        createdAt: comment.created_at,
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

export default router;
