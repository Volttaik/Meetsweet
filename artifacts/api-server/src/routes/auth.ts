import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { query, queryOne, queryRaw } from "../lib/db.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from "../lib/auth.js";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth.js";
import * as emailService from "../lib/email.js";

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
    emailVerified: user.email_verified ?? false,
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

// Generate 6-digit OTP code
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
    const normalizedEmail = email?.trim().toLowerCase();

    // Check unique email
    if (normalizedEmail) {
      const existing = await queryOne("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
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
      [userId, name.trim(), finalUsername, normalizedEmail ?? null, phone ?? null, passwordHash, bio ?? null, avatarUrl ?? null],
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

    // Persist the code before responding so verification is available immediately.
    if (normalizedEmail) {
      const code = generateCode();
      await queryRaw(
        `INSERT INTO email_verifications (user_id, email, code, type, expires_at)
         VALUES ($1, $2, $3, 'verify', NOW() + INTERVAL '15 minutes')`,
        [userId, normalizedEmail, code],
      );
      await Promise.all([
        emailService.sendWelcomeEmail(normalizedEmail, finalUsername),
        emailService.sendVerificationEmail(normalizedEmail, finalUsername, code),
      ]);
    }

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

// ─── GET /api/auth/check-username ────────────────────────────────────────────

router.get("/auth/check-username", async (req, res) => {
  try {
    const username = (req.query.username as string)?.trim();

    if (!username || username.length < 2) {
      res.json({ available: false, reason: "Too short" });
      return;
    }

    if (!/^[a-z0-9_.]{2,30}$/i.test(username)) {
      res.json({ available: false, reason: "Invalid characters (use letters, numbers, _ or .)" });
      return;
    }

    const existing = await queryOne(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`,
      [username],
    );

    res.json({ available: !existing });
  } catch (err) {
    console.error("Check username error:", err);
    res.status(500).json({ error: "Failed to check username" });
  }
});

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────

router.post("/auth/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body as { email: string; code: string };

    if (!email || !code) {
      res.status(400).json({ error: "Email and code are required" });
      return;
    }

    const record = await queryOne<{ id: string; user_id: string; code: string }>(
      `SELECT id, user_id, code FROM email_verifications
       WHERE email = $1 AND type = 'verify' AND expires_at > NOW() AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase()],
    );

    if (!record || record.code !== code.trim()) {
      res.status(400).json({ error: "Invalid or expired code" });
      return;
    }

    // Mark verified
    await queryRaw(`UPDATE users SET email_verified = true WHERE id = $1`, [record.user_id]);
    await queryRaw(`UPDATE email_verifications SET used_at = NOW() WHERE id = $1`, [record.id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Verify email error:", err);
    res.status(500).json({ error: "Failed to verify email" });
  }
});

// ─── POST /api/auth/resend-verification ──────────────────────────────────────

router.post("/auth/resend-verification", async (req, res) => {
  try {
    const { email } = req.body as { email: string };

    if (!email) {
      res.status(400).json({ error: "Email required" });
      return;
    }

    const user = await queryOne<{ id: string; name: string; username: string }>(
      `SELECT id, name, username FROM users WHERE email = $1`,
      [email.toLowerCase()],
    );

    // Always return success to prevent email enumeration
    if (!user) {
      res.json({ success: true });
      return;
    }

    const code = generateCode();
    await queryRaw(
      `INSERT INTO email_verifications (user_id, email, code, type, expires_at)
       VALUES ($1, $2, $3, 'verify', NOW() + INTERVAL '15 minutes')`,
      [user.id, email.toLowerCase(), code],
    );

    await emailService.sendVerificationEmail(email, user.username, code);

    res.json({ success: true });
  } catch (err) {
    console.error("Resend verification error:", err);
    res.status(500).json({ error: "Failed to resend code" });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body as { email: string };

    if (!email) {
      res.status(400).json({ error: "Email required" });
      return;
    }

    const user = await queryOne<{ id: string; name: string; username: string }>(
      `SELECT id, name, username FROM users WHERE email = $1`,
      [email.toLowerCase()],
    );

    // Always return success to prevent email enumeration
    if (!user) {
      res.json({ success: true });
      return;
    }

    const code = generateCode();
    await queryRaw(
      `INSERT INTO email_verifications (user_id, email, code, type, expires_at)
       VALUES ($1, $2, $3, 'reset', NOW() + INTERVAL '15 minutes')`,
      [user.id, email.toLowerCase(), code],
    );

    await emailService.sendPasswordResetEmail(email, user.username, code);

    res.json({ success: true });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Failed to send reset code" });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post("/auth/reset-password", async (req, res) => {
  try {
    const { email, code, password } = req.body as {
      email: string;
      code: string;
      password: string;
    };

    if (!email || !code || !password) {
      res.status(400).json({ error: "Email, code and password are required" });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const record = await queryOne<{ id: string; user_id: string; code: string }>(
      `SELECT id, user_id, code FROM email_verifications
       WHERE email = $1 AND type = 'reset' AND expires_at > NOW() AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase()],
    );

    if (!record || record.code !== code.trim()) {
      res.status(400).json({ error: "Invalid or expired code" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await queryRaw(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, record.user_id]);
    await queryRaw(`UPDATE email_verifications SET used_at = NOW() WHERE id = $1`, [record.id]);
    // Revoke all refresh tokens for security
    await queryRaw(`DELETE FROM refresh_tokens WHERE user_id = $1`, [record.user_id]);

    // Fetch user to send confirmation email
    queryOne<{ email: string; username: string }>(
      `SELECT email, username FROM users WHERE id = $1`,
      [record.user_id],
    ).then(async (u) => {
      if (u?.email) {
        await emailService.sendPasswordChangedEmail(u.email, u.username);
      }
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// ─── PUT /api/auth/password — change password (authenticated) ─────────────────

router.put("/auth/password", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "Current and new password required" });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters" });
      return;
    }

    const user = await queryOne<{ id: string; email: string; username: string; password_hash: string }>(
      `SELECT id, email, username, password_hash FROM users WHERE id = $1`,
      [req.user!.sub],
    );

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await queryRaw(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, user.id]);

    // Revoke all OTHER refresh tokens (current session stays active)
    await queryRaw(`DELETE FROM refresh_tokens WHERE user_id = $1`, [user.id]);

    // Send password changed email
    if (user.email) {
      await emailService.sendPasswordChangedEmail(user.email, user.username);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

export default router;
