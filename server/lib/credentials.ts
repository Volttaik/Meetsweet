import { createHash } from "crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { credential_grants } from "@/lib/db/schema";
import { config } from "@/lib/config";
import { generateId } from "@/lib/auth/codes";

export const BROKER_SCOPES = [
  "r2:upload",
  "r2:download",
] as const;

export type BrokerScope = (typeof BROKER_SCOPES)[number];

export interface ScopedCredentialPayload extends JWTPayload {
  sub: string;
  typ: "scoped";
  scopes: BrokerScope[];
}

function secret(): Uint8Array {
  const value = config.auth.jwtSecret();
  if (!value) throw new Error("JWT_SECRET or SESSION_SECRET is required");
  return new TextEncoder().encode(value);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isBrokerScope(value: string): value is BrokerScope {
  return (BROKER_SCOPES as readonly string[]).includes(value);
}

export async function issueScopedCredential(
  userId: string,
  scopes: BrokerScope[],
  requestedTtlSeconds = 300,
) {
  const ttlSeconds = Math.max(60, Math.min(requestedTtlSeconds, 900));
  const jti = generateId();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const token = await new SignJWT({ typ: "scoped", scopes })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret());

  await db.insert(credential_grants).values({
    id: jti,
    user_id: userId,
    token_hash: hashToken(token),
    scopes: JSON.stringify(scopes),
    expires_at: expiresAt.toISOString(),
  });

  return {
    credential: token,
    credential_id: jti,
    expires_at: expiresAt.toISOString(),
    expires_in: ttlSeconds,
    scopes,
  };
}

export async function verifyScopedCredential(
  token: string,
  requiredScope?: BrokerScope,
): Promise<ScopedCredentialPayload> {
  const { payload } = await jwtVerify(token, secret());
  const scoped = payload as ScopedCredentialPayload;
  if (scoped.typ !== "scoped" || !scoped.sub || !scoped.jti) {
    throw new Error("Not a scoped credential");
  }

  const [grant] = await db
    .select()
    .from(credential_grants)
    .where(
      and(
        eq(credential_grants.id, scoped.jti),
        eq(credential_grants.token_hash, hashToken(token)),
        isNull(credential_grants.revoked_at),
        gt(credential_grants.expires_at, new Date().toISOString()),
      ),
    )
    .limit(1);

  if (!grant) throw new Error("Credential revoked or expired");
  const scopes = Array.isArray(scoped.scopes)
    ? scoped.scopes.filter(isBrokerScope)
    : [];
  if (requiredScope && !scopes.includes(requiredScope)) {
    throw new Error("Credential does not grant the requested scope");
  }
  return { ...scoped, scopes };
}

export async function revokeScopedCredential(
  userId: string,
  token: string,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.typ !== "scoped" || payload.sub !== userId || !payload.jti) {
      return false;
    }
    const result = await db
      .update(credential_grants)
      .set({ revoked_at: new Date().toISOString() })
      .where(
        and(
          eq(credential_grants.id, payload.jti),
          eq(credential_grants.user_id, userId),
          isNull(credential_grants.revoked_at),
        ),
      );
    return result.rowsAffected > 0;
  } catch {
    return false;
  }
}