import { Router, type IRouter } from "express";
import { query, queryOne } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

// ─── GET /api/wallet ──────────────────────────────────────────────────────────

router.get("/wallet", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await queryOne<{ credits: number }>(
      `SELECT credits FROM users WHERE id = $1`,
      [req.user!.sub],
    );

    const transactions = await query<Record<string, unknown>>(
      `SELECT id, type, amount, description, created_at as "createdAt"
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user!.sub],
    );

    res.json({
      balance: user?.credits ?? 0,
      transactions,
    });
  } catch (err) {
    console.error("Wallet error:", err);
    res.status(500).json({ error: "Failed to fetch wallet" });
  }
});

export default router;
