import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { refresh_tokens } from "@/lib/db/schema";
import { verifyToken, signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { generateId, expiresAt } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { ok, unauthorized } from "@/lib/api/response";
import { refreshTokenSchema } from "@/schemas/auth";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, refreshTokenSchema);
  if (!parsed.success) return parsed.response;

  const { refresh_token } = parsed.data;

  // Verify the JWT signature and expiry first
  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(refresh_token);
  } catch {
    return unauthorized("Invalid or expired refresh token");
  }

  const tokenHash = createHash("sha256").update(refresh_token).digest("hex");
  const now = new Date().toISOString();

  // Check the token exists in the DB, is not revoked, and has not expired
  const [grant] = await db
    .select({ id: refresh_tokens.id })
    .from(refresh_tokens)
    .where(
      and(
        eq(refresh_tokens.token_hash, tokenHash),
        eq(refresh_tokens.user_id, payload.userId),
        isNull(refresh_tokens.revoked_at),
        gt(refresh_tokens.expires_at, now),
      ),
    )
    .limit(1);

  if (!grant) {
    return unauthorized("Refresh token has been revoked or expired");
  }

  // Rotate: revoke the old token and issue a new pair
  await db
    .update(refresh_tokens)
    .set({ revoked_at: now })
    .where(eq(refresh_tokens.id, grant.id));

  const tokenPayload = { userId: payload.userId, role: payload.role };
  const [newAccessToken, newRefreshToken] = await Promise.all([
    signAccessToken(tokenPayload),
    signRefreshToken(tokenPayload),
  ]);

  await db.insert(refresh_tokens).values({
    id: generateId(),
    user_id: payload.userId,
    token_hash: createHash("sha256").update(newRefreshToken).digest("hex"),
    expires_at: expiresAt(60 * 24 * 30), // 30 days
  });

  return ok({
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    token_type: "Bearer",
    expires_in: 900,
  });
}
