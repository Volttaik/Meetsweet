import { Router, type IRouter } from "express";
import { query, queryRaw } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

// ─── GET /api/notifications ───────────────────────────────────────────────────

router.get("/notifications", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.sub;
    const cursor = req.query.before as string | undefined;
    const limit = 30;

    const rows = await query<Record<string, unknown>>(
      `SELECT n.id, n.type, n.title, n.body, n.is_read, n.created_at, n.post_id,
              u.id as actor_id, u.name as actor_name, u.username as actor_username, u.avatar_url as actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = $1
         ${cursor ? "AND n.created_at < $3" : ""}
       ORDER BY n.created_at DESC
       LIMIT $2`,
      cursor ? [userId, limit, cursor] : [userId, limit],
    );

    // Unread count
    const [{ count }] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [userId],
    );

    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        isRead: n.is_read ?? false,
        postId: n.post_id ?? null,
        createdAt: n.created_at,
        actor: n.actor_id
          ? {
              id: n.actor_id,
              name: n.actor_name,
              username: n.actor_username,
              avatarUrl: n.actor_avatar ?? null,
            }
          : null,
      })),
      unreadCount: parseInt(count, 10),
      hasMore: rows.length === limit,
    });
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// ─── PUT /api/notifications/:id/read ─────────────────────────────────────────

router.put("/notifications/:id/read", requireAuth, async (req: AuthRequest, res) => {
  try {
    await queryRaw(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.sub],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

// ─── PUT /api/notifications/read-all ─────────────────────────────────────────

router.put("/notifications/read-all", requireAuth, async (req: AuthRequest, res) => {
  try {
    await queryRaw(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [req.user!.sub],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark all notifications read" });
  }
});

export default router;
