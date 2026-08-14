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
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, secret());
  return payload as TokenPayload;
}

// ─── Two-factor login challenge ───────────────────────────────────────────────
// A short-lived, single-purpose token issued after a successful password check
// for accounts with TOTP enabled. It cannot be used as an access token; it only
// authorises the 2FA verification step.

export interface TotpChallengePayload extends JWTPayload {
  userId: string;
  purpose: string;
}

export async function signTotpChallenge(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: "totp_login" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret());
}

export async function verifyTotpChallenge(token: string): Promise<TotpChallengePayload> {
  const { payload } = await jwtVerify(token, secret());
  if (payload.purpose !== "totp_login") throw new Error("Invalid challenge purpose");
  return payload as TotpChallengePayload;
}
