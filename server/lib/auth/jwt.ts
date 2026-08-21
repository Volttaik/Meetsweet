import { randomUUID } from "crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { config } from "@/lib/config";

const secret = () => {
  const s = config.auth.jwtSecret();
  if (!s) throw new Error("JWT_SECRET or SESSION_SECRET is required");
  return new TextEncoder().encode(s);
};

export interface TokenPayload extends JWTPayload {
  userId: string;
  role: string;
}

export async function signAccessToken(payload: Omit<TokenPayload, "iat" | "exp">): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret());
}

export async function signRefreshToken(payload: Omit<TokenPayload, "iat" | "exp">): Promise<string> {
  // A unique jti makes every signed token distinct even when two tokens are
  // created within the same second (the default `iat` has second granularity).
  // Without it, two rapid logins / a login+refresh inside one second produced
  // byte-identical JWTs whose sha256 hashes collided on the unique
  // refresh_tokens.token_hash index and the route died with a 500.
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, secret());
  return payload as TokenPayload;
}

// ─── Two-factor login challenge ───────────────────────────────────────────────
// A short-lived, single-purpose token issued after a successful password check
// for accounts with 2FA (email-code) enabled. It cannot be used as an access
// token; it only authorises the 2FA verification step.

export interface TwoFactorChallengePayload extends JWTPayload {
  userId: string;
  purpose: string;
}

export async function signTwoFactorChallenge(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: "two_fa_login" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret());
}

export async function verifyTwoFactorChallenge(token: string): Promise<TwoFactorChallengePayload> {
  const { payload } = await jwtVerify(token, secret());
  if (payload.purpose !== "two_fa_login") throw new Error("Invalid challenge purpose");
  return payload as TwoFactorChallengePayload;
}
