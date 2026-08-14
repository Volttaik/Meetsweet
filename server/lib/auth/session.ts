/**
 * session.ts — shared access/refresh token issuance.
 *
 * Used by both the password login route and the 2FA verification route so the
 * two entry points produce an identical session shape and both write the refresh
 * token row the same way.
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { refresh_tokens } from "@/lib/db/schema";
import { signAccessToken, signRefreshToken } from "./jwt";
import { generateId, expiresAt } from "./codes";

export interface IssuedSession {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export async function issueSession(
  userId: string,
  role: string,
  deviceId?: string | null,
): Promise<IssuedSession> {
  const tokenPayload = { userId, role };
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(tokenPayload),
    signRefreshToken(tokenPayload),
  ]);

  const refreshExpiry = expiresAt(60 * 24 * 30); // 30 days
  await db.insert(refresh_tokens).values({
    id: generateId(),
    user_id: userId,
    token_hash: createHash("sha256").update(refreshToken).digest("hex"),
    device_id: deviceId ?? null,
    expires_at: refreshExpiry,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 900,
  };
}
