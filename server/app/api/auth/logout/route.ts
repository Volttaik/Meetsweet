import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { refresh_tokens } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { z } from "zod";
import { createHash } from "crypto";

const schema = z.object({ refresh_token: z.string().optional() });

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  if (parsed.data.refresh_token) {
    const hash = createHash("sha256").update(parsed.data.refresh_token).digest("hex");
    await db
      .update(refresh_tokens)
      .set({ revoked_at: new Date().toISOString() })
      .where(eq(refresh_tokens.token_hash, hash));
  }

  return ok(null, "Logged out successfully");
}
