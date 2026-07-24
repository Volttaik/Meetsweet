import { Router, type IRouter } from "express";
import { query, queryOne } from "../lib/db.js";
import { requireAuth, optionalAuth, type AuthRequest } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

function publicUser(user: Record<string, unknown>) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email ?? null,
    phone: user.phone ?? null,
    bio: user.bio ?? null,
    avatarUrl: user.avatar_url ?? null,
    bannerUrl: user.banner_url ?? null,
    isVerified: user.is_verified ?? false,
    isCreator: user.is_creator ?? false,
    credits: user.credits ?? 0,
    followerCount: user.follower_count ?? 0,
    followingCount: user.following_count ?? 0,
    subscriberCount: user.subscriber_count ?? 0,
    postCount: user.post_count ?? 0,
    createdAt: user.created_at,
  };
}

// ─── GET /api/users/me ────────────────────────────────────────────────────────

router.get("/users/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await queryOne<Record<string, unknown>>(
      `SELECT * FROM users WHERE id = $1`,
      [req.user!.sub],
    );
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("Get me error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ─── PUT /api/users/me ────────────────────────────────────────────────────────

router.put("/users/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, bio, avatarUrl, bannerUrl } = req.body as {
      name?: string;
      bio?: string;
      avatarUrl?: string;
      bannerUrl?: string;
    };

    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(name.trim());
    }
    if (bio !== undefined) {
      updates.push(`bio = $${idx++}`);
      params.push(bio);
    }
    if (avatarUrl !== undefined) {
      updates.push(`avatar_url = $${idx++}`);
      params.push(avatarUrl);
    }
    if (bannerUrl !== undefined) {
      updates.push(`banner_url = $${idx++}`);
      params.push(bannerUrl);
    }

    if (updates.length === 0) {
      const user = await queryOne<Record<string, unknown>>(
        `SELECT * FROM users WHERE id = $1`,
        [req.user!.sub],
      );
      res.json({ user: publicUser(user!) });
      return;
    }

    updates.push(`updated_at = NOW()`);
    params.push(req.user!.sub);

    const [user] = await query<Record<string, unknown>>(
      `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      params,
    );

    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("Update me error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ─── GET /api/users/:username ─────────────────────────────────────────────────

router.get("/users/:username", optionalAuth, async (req: AuthRequest, res) => {
  try {
    const username = String(req.params.username);

    const user = await queryOne<Record<string, unknown>>(
      `SELECT * FROM users WHERE username = $1`,
      [username.toLowerCase()],
    );

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let isFollowing = false;
    if (req.user) {
      const follow = await queryOne(
        `SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2`,
        [req.user.sub, user.id],
      );
      isFollowing = !!follow;
    }

    // Get recent posts count
    const posts = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM posts WHERE user_id = $1 AND visibility != 'draft'`,
      [user.id],
    );

    res.json({
      user: { ...publicUser(user), postCount: parseInt(posts[0]?.count ?? "0") },
      isFollowing,
    });
  } catch (err) {
    console.error("Get user error:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ─── POST /api/users/:username/follow ─────────────────────────────────────────

router.post("/users/:username/follow", requireAuth, async (req: AuthRequest, res) => {
  try {
    const username = String(req.params.username);
    const target = await queryOne<Record<string, unknown>>(
      `SELECT id FROM users WHERE username = $1`,
      [username.toLowerCase()],
    );

    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (target.id === req.user!.sub) {
      res.status(400).json({ error: "Cannot follow yourself" });
      return;
    }

    await query(
      `INSERT INTO follows (id, follower_id, following_id) VALUES (gen_random_uuid(), $1, $2) ON CONFLICT DO NOTHING`,
      [req.user!.sub, target.id],
    );

    // Update counts
    await query(`UPDATE users SET follower_count = follower_count + 1 WHERE id = $1`, [target.id]);
    await query(`UPDATE users SET following_count = following_count + 1 WHERE id = $1`, [req.user!.sub]);

    res.json({ following: true });
  } catch (err) {
    console.error("Follow error:", err);
    res.status(500).json({ error: "Failed to follow user" });
  }
});

// ─── DELETE /api/users/:username/follow ───────────────────────────────────────

router.delete("/users/:username/follow", requireAuth, async (req: AuthRequest, res) => {
  try {
    const username = String(req.params.username);
    const target = await queryOne<Record<string, unknown>>(
      `SELECT id FROM users WHERE username = $1`,
      [username.toLowerCase()],
    );

    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const result = await query(
      `DELETE FROM follows WHERE follower_id = $1 AND following_id = $2`,
      [req.user!.sub, target.id],
    );

    if ((result as unknown as { rowCount: number }).rowCount > 0) {
      await query(`UPDATE users SET follower_count = GREATEST(0, follower_count - 1) WHERE id = $1`, [target.id]);
      await query(`UPDATE users SET following_count = GREATEST(0, following_count - 1) WHERE id = $1`, [req.user!.sub]);
    }

    res.json({ following: false });
  } catch (err) {
    console.error("Unfollow error:", err);
    res.status(500).json({ error: "Failed to unfollow user" });
  }
});

export default router;
