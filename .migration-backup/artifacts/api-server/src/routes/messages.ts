import { Router, type IRouter } from "express";
import { query, queryOne, queryRaw } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

// ─── GET /api/conversations ───────────────────────────────────────────────────

router.get("/conversations", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.sub;
    const tab = (req.query.tab as string) ?? "all";

    let extraWhere = "";
    if (tab === "archived") extraWhere = "AND cp.is_archived = true";
    else extraWhere = "AND cp.is_archived = false";

    const rows = await query<Record<string, unknown>>(
      `SELECT
         c.id,
         c.last_message_body,
         c.last_message_at,
         c.created_at,
         cp.last_read_at,
         cp.is_muted,
         cp.is_archived,
         -- other participant
         other_u.id         AS other_user_id,
         other_u.name       AS other_name,
         other_u.username   AS other_username,
         other_u.avatar_url AS other_avatar_url,
         other_u.is_verified AS other_is_verified,
         -- unread count
         (SELECT COUNT(*) FROM messages m
          WHERE m.conversation_id = c.id
            AND m.sender_id <> $1
            AND m.is_deleted = false
            AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
         ) AS unread_count
       FROM conversation_participants cp
       JOIN conversations c ON c.id = cp.conversation_id
       JOIN conversation_participants other_cp ON other_cp.conversation_id = c.id AND other_cp.user_id <> $1
       JOIN users other_u ON other_u.id = other_cp.user_id
       WHERE cp.user_id = $1
       ${extraWhere}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT 50`,
      [userId],
    );

    res.json({
      conversations: rows.map((r) => ({
        id: r.id,
        lastMessageBody: r.last_message_body ?? null,
        lastMessageAt: r.last_message_at ?? null,
        createdAt: r.created_at,
        isMuted: r.is_muted ?? false,
        isArchived: r.is_archived ?? false,
        unreadCount: Number(r.unread_count ?? 0),
        otherUser: {
          id: r.other_user_id,
          name: r.other_name,
          username: r.other_username,
          avatarUrl: r.other_avatar_url ?? null,
          isVerified: r.other_is_verified ?? false,
        },
      })),
    });
  } catch (err) {
    console.error("Get conversations error:", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// ─── POST /api/conversations ──────────────────────────────────────────────────
// Create or retrieve conversation with a given user

router.post("/conversations", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { userId: otherUserId } = req.body as { userId: string };
    const myId = req.user!.sub;

    if (!otherUserId) {
      res.status(400).json({ error: "userId required" });
      return;
    }
    if (otherUserId === myId) {
      res.status(400).json({ error: "Cannot message yourself" });
      return;
    }

    // Check target user exists
    const target = await queryOne(`SELECT id FROM users WHERE id = $1`, [otherUserId]);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Find existing conversation between the two
    const existing = await queryOne<{ id: string }>(
      `SELECT c.id FROM conversations c
       JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = $1
       JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = $2`,
      [myId, otherUserId],
    );

    if (existing) {
      res.json({ conversationId: existing.id, created: false });
      return;
    }

    // Create new conversation
    const conv = await queryOne<{ id: string }>(
      `INSERT INTO conversations DEFAULT VALUES RETURNING id`,
    );
    const convId = conv!.id;

    await queryRaw(
      `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [convId, myId, otherUserId],
    );

    res.status(201).json({ conversationId: convId, created: true });
  } catch (err) {
    console.error("Create conversation error:", err);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// ─── GET /api/conversations/:id/messages ─────────────────────────────────────

router.get("/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
  try {
    const convId = req.params.id;
    const userId = req.user!.sub;

    // Verify membership
    const member = await queryOne(
      `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
      [convId, userId],
    );
    if (!member) {
      res.status(403).json({ error: "Not a participant" });
      return;
    }

    const cursor = req.query.before as string | undefined;
    const limit = 40;

    const rows = await query<Record<string, unknown>>(
      `SELECT m.id, m.body, m.media_url, m.media_type, m.is_deleted, m.created_at,
              u.id as sender_id, u.name as sender_name, u.username as sender_username, u.avatar_url as sender_avatar
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
         ${cursor ? "AND m.created_at < $3" : ""}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      cursor ? [convId, limit, cursor] : [convId, limit],
    );

    // Mark as read
    await queryRaw(
      `UPDATE conversation_participants SET last_read_at = NOW()
       WHERE conversation_id = $1 AND user_id = $2`,
      [convId, userId],
    );

    res.json({
      messages: rows.reverse().map((m) => ({
        id: m.id,
        body: m.is_deleted ? null : m.body,
        mediaUrl: m.is_deleted ? null : (m.media_url ?? null),
        mediaType: m.media_type ?? null,
        isDeleted: m.is_deleted ?? false,
        createdAt: m.created_at,
        sender: {
          id: m.sender_id,
          name: m.sender_name,
          username: m.sender_username,
          avatarUrl: m.sender_avatar ?? null,
        },
        isOwn: m.sender_id === userId,
      })),
      hasMore: rows.length === limit,
    });
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// ─── POST /api/conversations/:id/messages ─────────────────────────────────────

router.post("/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
  try {
    const convId = req.params.id;
    const userId = req.user!.sub;

    // Verify membership
    const member = await queryOne(
      `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
      [convId, userId],
    );
    if (!member) {
      res.status(403).json({ error: "Not a participant" });
      return;
    }

    const { body, mediaUrl, mediaType } = req.body as {
      body?: string;
      mediaUrl?: string;
      mediaType?: string;
    };

    if (!body?.trim() && !mediaUrl) {
      res.status(400).json({ error: "Message body or media required" });
      return;
    }

    const [msg] = await query<Record<string, unknown>>(
      `INSERT INTO messages (conversation_id, sender_id, body, media_url, media_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [convId, userId, body?.trim() ?? null, mediaUrl ?? null, mediaType ?? null],
    );

    // Update conversation last message
    await queryRaw(
      `UPDATE conversations SET last_message_body = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [body?.trim() ?? (mediaUrl ? "📎 Media" : ""), convId],
    );

    // Update own read timestamp
    await queryRaw(
      `UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
      [convId, userId],
    );

    // Notify other participant
    queryOne<{ user_id: string }>(
      `SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id <> $2 LIMIT 1`,
      [convId, userId],
    ).then(async (other) => {
      if (other) {
        const actor = await queryOne<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
        await queryRaw(
          `INSERT INTO notifications (user_id, type, title, body, actor_id)
           VALUES ($1, 'message', $2, $3, $4)`,
          [
            other.user_id,
            "New message",
            `${actor?.name ?? "Someone"} sent you a message`,
            userId,
          ],
        );
      }
    }).catch(() => {});

    const sender = await queryOne<Record<string, unknown>>(
      `SELECT id, name, username, avatar_url FROM users WHERE id = $1`,
      [userId],
    );

    res.status(201).json({
      message: {
        id: msg.id,
        body: msg.body,
        mediaUrl: msg.media_url ?? null,
        mediaType: msg.media_type ?? null,
        isDeleted: false,
        createdAt: msg.created_at,
        sender: {
          id: sender!.id,
          name: sender!.name,
          username: sender!.username,
          avatarUrl: sender!.avatar_url ?? null,
        },
        isOwn: true,
      },
    });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── DELETE /api/messages/:id ─────────────────────────────────────────────────

router.delete("/messages/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const msg = await queryOne<Record<string, unknown>>(
      `SELECT id, sender_id FROM messages WHERE id = $1`,
      [req.params.id],
    );
    if (!msg) { res.status(404).json({ error: "Message not found" }); return; }
    if (msg.sender_id !== req.user!.sub) { res.status(403).json({ error: "Not your message" }); return; }
    await queryRaw(`UPDATE messages SET is_deleted = true, body = null WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete message error:", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// ─── PUT /api/conversations/:id/archive ───────────────────────────────────────

router.put("/conversations/:id/archive", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { archived } = req.body as { archived: boolean };
    await queryRaw(
      `UPDATE conversation_participants SET is_archived = $1 WHERE conversation_id = $2 AND user_id = $3`,
      [archived ?? true, req.params.id, req.user!.sub],
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Archive error:", err);
    res.status(500).json({ error: "Failed to archive" });
  }
});

// ─── PUT /api/conversations/:id/mute ─────────────────────────────────────────

router.put("/conversations/:id/mute", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { muted } = req.body as { muted: boolean };
    await queryRaw(
      `UPDATE conversation_participants SET is_muted = $1 WHERE conversation_id = $2 AND user_id = $3`,
      [muted ?? true, req.params.id, req.user!.sub],
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Mute error:", err);
    res.status(500).json({ error: "Failed to mute" });
  }
});

// ─── PUT /api/messages/:id — edit a message ───────────────────────────────────

router.put("/messages/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const msg = await queryOne<Record<string, unknown>>(
      `SELECT id, sender_id, is_deleted FROM messages WHERE id = $1`,
      [req.params.id],
    );

    if (!msg) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (msg.sender_id !== req.user!.sub) {
      res.status(403).json({ error: "Not your message" });
      return;
    }
    if (msg.is_deleted) {
      res.status(400).json({ error: "Cannot edit a deleted message" });
      return;
    }

    const { body } = req.body as { body: string };
    if (!body?.trim()) {
      res.status(400).json({ error: "Message body required" });
      return;
    }

    await queryRaw(
      `UPDATE messages SET body = $1, is_edited = true, updated_at = NOW() WHERE id = $2`,
      [body.trim(), req.params.id],
    );

    res.json({
      success: true,
      message: {
        id: msg.id,
        body: body.trim(),
        isEdited: true,
      },
    });
  } catch (err) {
    console.error("Edit message error:", err);
    res.status(500).json({ error: "Failed to edit message" });
  }
});

// ─── GET /api/users/search — search users to start a conversation ──────────────

router.get("/users/search", requireAuth, async (req: AuthRequest, res) => {
  try {
    const q = (req.query.q as string)?.trim().toLowerCase();
    if (!q || q.length < 2) {
      res.json({ users: [] });
      return;
    }
    const users = await query<Record<string, unknown>>(
      `SELECT id, name, username, avatar_url, is_verified, is_creator
       FROM users
       WHERE (LOWER(name) LIKE $1 OR LOWER(username) LIKE $1)
         AND id <> $2
       ORDER BY username ASC
       LIMIT 20`,
      [`%${q}%`, req.user!.sub],
    );
    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        avatarUrl: u.avatar_url ?? null,
        isVerified: u.is_verified ?? false,
        isCreator: u.is_creator ?? false,
      })),
    });
  } catch (err) {
    console.error("User search error:", err);
    res.status(500).json({ error: "Failed to search users" });
  }
});

export default router;
