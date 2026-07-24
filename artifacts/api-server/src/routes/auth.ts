import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { query, queryOne } from "../lib/db.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from "../lib/auth.js";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

// Format user for API response (strip sensitive fields)
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

// Generate username from name
function generateUsername(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);
  const suffix = Math.floor(Math.random() * 9000) + 1000;
  return `${base}${suffix}`;
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────

router.post("/auth/register", async (req, res) => {
  try {
    const { name, username, email, phone, password, bio, avatarUrl } = req.body as {
      name: string;
      username?: string;
      email?: string;
      phone?: string;
      password: string;
      bio?: string;
      avatarUrl?: string;
    };

    // Validation
    if (!name || name.trim().length < 2) {
      res.status(400).json({ error: "Name must be at least 2 characters" });
      return;
    }
    if (!password || password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    if (!email && !phone) {
      res.status(400).json({ error: "Email or phone is required" });
      return;
    }

    // Check unique email
    if (email) {
      const existing = await queryOne("SELECT id FROM users WHERE email = $1", [email]);
      if (existing) {
        res.status(409).json({ error: "Email is already registered" });
        return;
      }
    }

    // Check unique phone
    if (phone) {
      const existing = await queryOne("SELECT id FROM users WHERE phone = $1", [phone]);
      if (existing) {
        res.status(409).json({ error: "Phone number is already registered" });
        return;
      }
    }

    // Resolve username
    let finalUsername = username?.trim().toLowerCase() ?? generateUsername(name);
    if (finalUsername) {
      const existingUser = await queryOne("SELECT id FROM users WHERE username = $1", [finalUsername]);
      if (existingUser) {
        finalUsername = generateUsername(name);
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    // Insert user
    const [user] = await query<Record<string, unknown>>(
      `INSERT INTO users (id, name, username, email, phone, password_hash, bio, avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, name.trim(), finalUsername, email ?? null, phone ?? null, passwordHash, bio ?? null, avatarUrl ?? null],
    );

    // Create tokens
    const [accessToken, { token: refreshToken, tokenHash, expiresAt }] = await Promise.all([
      signAccessToken({ sub: userId, username: finalUsername }),
      signRefreshToken({ sub: userId, username: finalUsername }),
    ]);

    // Store refresh token
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), userId, tokenHash, expiresAt],
    );

    // Give 500 welcome credits
    await query(
      `UPDATE users SET credits = 500 WHERE id = $1`,
      [userId],
    );
    await query(
      `INSERT INTO transactions (id, user_id, type, amount, description) VALUES ($1, $2, 'credit', 500, 'Welcome bonus')`,
      [uuidv4(), userId],
    );
    user.credits = 500;

    res.status(201).json({
      user: publicUser(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post("/auth/login", async (req, res) => {
  try {
    const { identifier, password } = req.body as { identifier: string; password: string };

    if (!identifier || !password) {
      res.status(400).json({ error: "Identifier and password are required" });
      return;
    }

    // Find user by email, username, or phone
    const user = await queryOne<Record<string, unknown>>(
      `SELECT * FROM users WHERE email = $1 OR username = $1 OR phone = $1 LIMIT 1`,
      [identifier.trim().toLowerCase()],
    );

    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash as string);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const userId = user.id as string;
    const username = user.username as string;

    const [accessToken, { token: refreshToken, tokenHash, expiresAt }] = await Promise.all([
      signAccessToken({ sub: userId, username }),
      signRefreshToken({ sub: userId, username }),
    ]);

    await query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), userId, tokenHash, expiresAt],
    );

    res.json({ user: publicUser(user), accessToken, refreshToken });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

router.post("/auth/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    if (!refreshToken) {
      res.status(400).json({ error: "Refresh token required" });
      return;
    }

    const payload = await verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const stored = await queryOne(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2 AND expires_at > NOW()`,
      [tokenHash, payload.sub],
    );

    if (!stored) {
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }

    // Rotate refresh token
    await query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [tokenHash]);

    const [newAccessToken, { token: newRefreshToken, tokenHash: newHash, expiresAt }] = await Promise.all([
      signAccessToken(payload),
      signRefreshToken(payload),
    ]);

    await query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), payload.sub, newHash, expiresAt],
    );

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch {
    res.status(401).json({ error: "Invalid refresh token" });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get("/auth/me", requireAuth, async (req: AuthRequest, res) => {
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
    console.error("Me error:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

router.post("/auth/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [tokenHash]);
    }
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

export default router;
