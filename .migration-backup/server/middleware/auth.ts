import { NextRequest } from "next/server";
import { verifyToken, type TokenPayload } from "@/lib/auth/jwt";
import { unauthorized } from "@/lib/api/response";
import { NextResponse } from "next/server";

export type AuthedRequest = NextRequest & { user: TokenPayload };

export async function requireAuth(
  req: NextRequest
): Promise<{ user: TokenPayload } | { response: NextResponse }> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { response: unauthorized("Missing authorization header") };
  }

  const token = header.slice(7);
  try {
    const user = await verifyToken(token);
    return { user };
  } catch {
    return { response: unauthorized("Invalid or expired token") };
  }
}

export async function optionalAuth(
  req: NextRequest
): Promise<TokenPayload | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return await verifyToken(header.slice(7));
  } catch {
    return null;
  }
}
