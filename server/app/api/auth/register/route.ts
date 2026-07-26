import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, user_settings, refresh_tokens } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { generateId, expiresAt } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { created, err } from "@/lib/api/response";
import { registerSchema } from "@/schemas/auth";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, registerSchema);
  if (!parsed.success) return parsed.response;

  const { full_name, username, email, phone, password } = parsed.data;

  // Check for existing email or username
  const [existing] = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(or(eq(users.email, email), eq(users.username, username)))
    .limit(1);

  if (existing) {
    if (existing.email === email) {
      return err("An account with this email already exists", 409);
    }
    return err("This username is already taken", 409);
  }

  const password_hash = await hashPassword(password);
  const userId = generateId();

  // Create user, profile, and settings in sequence (Turso/libsql doesn't support batch inserts across tables in one call)
  await db.insert(users).values({
    id: userId,
    full_name,
    username,
    email,
    phone: phone ?? null,
    password_hash,
    role: "user",
  });

  await db.insert(profiles).values({
    id: generateId(),
    user_id: userId,
    display_name: full_name,
    avatar_url: null,
  });

  await db.insert(user_settings).values({
    id: generateId(),
    user_id: userId,
    biometric_login: false,
  });

  // Issue tokens
  const tokenPayload = { userId, role: "user" };
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(tokenPayload),
    signRefreshToken(tokenPayload),
  ]);

  const refreshExpiry = expiresAt(60 * 24 * 30); // 30 days
  await db.insert(refresh_tokens).values({
    id: generateId(),
    user_id: userId,
    token_hash: createHash("sha256").update(refreshToken).digest("hex"),
    expires_at: refreshExpiry,
  });

  return created({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 900, // 15 minutes in seconds
    user: {
      id: userId,
      full_name,
      username,
      email,
      role: "user",
      is_creator: false,
    },
  });
}
