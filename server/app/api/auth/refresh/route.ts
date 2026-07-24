import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { refresh_tokens, users } from "@/lib/db/schema";
import { verifyToken, signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { generateId, expiresAt } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { ok, unauthorized } from "@/lib/api/response";
import { refreshTokenSchema } from "@/schemas/auth";
import { createHash } from "crypto";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, refreshTokenSchema);
  if (!parsed.success) return parsed.response;

  let payload;
  try {
    payload = await verifyToken(parsed.data.refresh_token);
  } catch {
    return unauthorized("Invalid refresh token");
  }

  const tokenHash = hashToken(parsed.data.refresh_token);

  const [stored] = await db
    .select()
    .from(refresh_tokens)
    .where(
      and(
        eq(refresh_tokens.token_hash, tokenHash),
        isNull(refresh_tokens.revoked_at)
      )
    )
    .limit(1);

  if (!stored) return unauthorized("Refresh token revoked or not found");

  const [user] = await db
    .select({ id: users.id, role: users.role, is_active: users.is_active })
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!user || !user.is_active) return unauthorized("Account not found or inactive");

  // Rotate: revoke old, issue new pair
  await db
    .update(refresh_tokens)
    .set({ revoked_at: new Date().toISOString() })
    .where(eq(refresh_tokens.id, stored.id));

  const tokenPayload = { userId: user.id, role: user.role };
  const [accessToken, newRefreshToken] = await Promise.all([
    signAccessToken(tokenPayload),
    signRefreshToken(tokenPayload),
  ]);

  await db.insert(refresh_tokens).values({
    id: generateId(),
    user_id: user.id,
    token_hash: hashToken(newRefreshToken),
    device_id: stored.device_id,
    expires_at: expiresAt(30 * 24 * 60),
  });

  return ok({ access_token: accessToken, refresh_token: newRefreshToken });
}
