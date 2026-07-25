import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, refresh_tokens, login_history } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { generateId, expiresAt } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { ok, err, unauthorized } from "@/lib/api/response";
import { loginSchema } from "@/schemas/auth";
import { resolveUrl } from "@/lib/services/r2";
import { createHash } from "crypto";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, loginSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, body.email.toLowerCase()))
    .limit(1);

  // Record failed attempt for unknown email
  if (!user) {
    await db.insert(login_history).values({
      id: generateId(),
      user_id: generateId(), // placeholder — no real user
      ip_address: ip,
      user_agent: ua,
      device_id: body.device_id,
      status: "failed",
    }).catch(() => {}); // best-effort
    return unauthorized("Invalid credentials");
  }

  if (!user.is_active) return err("Account is deactivated", 403);

  const valid = await verifyPassword(user.password_hash, body.password);

  // Record login attempt
  await db.insert(login_history).values({
    id: generateId(),
    user_id: user.id,
    ip_address: ip,
    user_agent: ua,
    device_id: body.device_id,
    status: valid ? "success" : "failed",
  }).catch(() => {});

  if (!valid) return unauthorized("Invalid credentials");

  if (!user.is_verified) {
    return err("Please verify your email before logging in", 403, "EMAIL_NOT_VERIFIED");
  }

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.user_id, user.id))
    .limit(1);

  const payload = { userId: user.id, role: user.role };
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(payload),
    signRefreshToken(payload),
  ]);

  await db.insert(refresh_tokens).values({
    id: generateId(),
    user_id: user.id,
    token_hash: hashToken(refreshToken),
    device_id: body.device_id,
    expires_at: expiresAt(30 * 24 * 60),
  });

  return ok({
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      email: user.email,
      role: user.role,
      is_creator: user.is_creator,
      avatar_url: await resolveUrl(profile?.avatar_url ?? null),
    },
  });
}
