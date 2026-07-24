import { Router, type IRouter } from "express";
import { query } from "../lib/db.js";

const router: IRouter = Router();

// ─── GET /api/search ──────────────────────────────────────────────────────────
// Query: ?q=string&type=all|users|posts&page=1&limit=20

router.get("/search", async (req, res) => {
  try {
    const q = ((req.query.q as string) ?? "").trim();
    if (!q || q.length < 2) {
      res.json({ users: [], posts: [] });
      return;
    }

    const type = (req.query.type as string) ?? "all";
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), 50);
    const pattern = `%${q.toLowerCase()}%`;

    const results: { users: unknown[]; posts: unknown[] } = {
      users: [],
      posts: [],
    };

    if (type === "all" || type === "users") {
      const users = await query<Record<string, unknown>>(
        `SELECT id, name, username, bio, avatar_url, is_verified, is_creator, follower_count
         FROM users
         WHERE LOWER(name) LIKE $1 OR LOWER(username) LIKE $1
         ORDER BY follower_count DESC
         LIMIT $2`,
        [pattern, limit],
      );
      results.users = users.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        bio: u.bio ?? null,
        avatarUrl: u.avatar_url ?? null,
        isVerified: u.is_verified ?? false,
        isCreator: u.is_creator ?? false,
        followerCount: u.follower_count ?? 0,
      }));
    }

    if (type === "all" || type === "posts") {
      const posts = await query<Record<string, unknown>>(
        `SELECT p.id, p.caption, p.media_url, p.media_type, p.thumbnail_url,
                p.like_count, p.comment_count, p.is_premium, p.created_at,
                u.id as user_id, u.name, u.username, u.avatar_url, u.is_verified
         FROM posts p
         JOIN users u ON p.user_id = u.id
         WHERE p.visibility = 'public' AND LOWER(p.caption) LIKE $1
         ORDER BY p.created_at DESC
         LIMIT $2`,
        [pattern, limit],
      );
      results.posts = posts.map((p) => ({
        id: p.id,
        caption: p.caption,
        mediaUrl: p.media_url ?? null,
        mediaType: p.media_type ?? null,
        thumbnailUrl: p.thumbnail_url ?? null,
        likeCount: p.like_count ?? 0,
        commentCount: p.comment_count ?? 0,
        isPremium: p.is_premium ?? false,
        createdAt: p.created_at,
        author: {
          id: p.user_id,
          name: p.name,
          username: p.username,
          avatarUrl: p.avatar_url ?? null,
          isVerified: p.is_verified ?? false,
        },
      }));
    }

    res.json(results);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
