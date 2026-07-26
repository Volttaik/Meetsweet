import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { refresh_tokens } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { refreshTokenSchema } from "@/schemas/auth";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  // Body is optional — if a refresh_token is provided, revoke just that one.
  // If not, this is a best-effort logout (access token expiry handles the rest).
  let refreshToken: string | undefined;
  try {
    const body = await req.json();
    const parsed = refreshTokenSchema.safeParse(body);
    if (parsed.success) {
      refreshToken = parsed.data.refresh_token;
    }
  } catch {
    // No body or invalid JSON — that's fine, proceed without revoking a specific token
  }

  if (refreshToken) {
    const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
    await db
      .update(refresh_tokens)
      .set({ revoked_at: new Date().toISOString() })
      .where(
        and(
          eq(refresh_tokens.token_hash, tokenHash),
          eq(refresh_tokens.user_id, auth.user.userId),
          isNull(refresh_tokens.revoked_at),
        ),
      );
  }

  return ok({ logged_out: true });
}
