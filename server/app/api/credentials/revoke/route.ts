import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { revokeScopedCredential } from "@/lib/credentials";

const schema = z.object({ credential: z.string().min(1) });

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;
  const revoked = await revokeScopedCredential(
    auth.user.userId,
    parsed.data.credential,
  );
  if (!revoked) return err("Credential is invalid or already revoked", 404);
  return ok({ revoked: true });
}