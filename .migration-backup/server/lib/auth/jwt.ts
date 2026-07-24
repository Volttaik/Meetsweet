import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const secret = () => {
  const s = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
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
