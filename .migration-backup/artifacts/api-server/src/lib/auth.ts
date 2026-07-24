import { SignJWT, jwtVerify } from "jose";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "node:crypto";

const ACCESS_SECRET = new TextEncoder().encode(
  process.env.JWT_ACCESS_SECRET ?? process.env.SESSION_SECRET ?? "meetsweet-access-secret-change-me",
);
const REFRESH_SECRET = new TextEncoder().encode(
  process.env.JWT_REFRESH_SECRET ?? (process.env.SESSION_SECRET ?? "meetsweet-refresh-secret-change-me") + "-refresh",
);

const ACCESS_EXPIRY = "15m";
const REFRESH_EXPIRY = "30d";

export interface JwtPayload {
  sub: string; // user id
  username: string;
}

export async function signAccessToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_EXPIRY)
    .sign(ACCESS_SECRET);
}

export async function signRefreshToken(payload: JwtPayload): Promise<{ token: string; tokenHash: string; expiresAt: Date }> {
  const token = await new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setJti(uuidv4())
    .setIssuedAt()
    .setExpirationTime(REFRESH_EXPIRY)
    .sign(REFRESH_SECRET);

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return { token, tokenHash, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, ACCESS_SECRET);
  return { sub: payload.sub as string, username: payload.username as string };
}

export async function verifyRefreshToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, REFRESH_SECRET);
  return { sub: payload.sub as string, username: payload.username as string };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
