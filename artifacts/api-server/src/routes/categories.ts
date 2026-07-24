import { Router, type IRouter } from "express";
import { query } from "../lib/db.js";

const router: IRouter = Router();

router.get("/categories", async (_req, res) => {
  try {
    const categories = await query<Record<string, unknown>>(
      `SELECT id, name, slug, post_count as "postCount" FROM categories ORDER BY name ASC`,
    );
    res.json({ categories });
  } catch (err) {
    console.error("Categories error:", err);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

export default router;
