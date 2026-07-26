import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import {
  type BrokerScope,
  isBrokerScope,
  issueScopedCredential,
  revokeScopedCredential,
} from "@/lib/credentials";

const schema = z.object({
  credential: z.string().min(1),
  scopes: z.array(z.string()).min(1).max(2),
  ttl_seconds: z.number().int().min(60).max(900).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;
  if (!parsed.data.scopes.every(isBrokerScope)) {
    return err("Requested scope is not supported", 422);
  }

  const revoked = await revokeScopedCredential(
    auth.user.userId,
    parsed.data.credential,
  );
  if (!revoked) return err("Credential is invalid or already revoked", 401);

  return ok(
    await issueScopedCredential(
      auth.user.userId,
      [...new Set(parsed.data.scopes)] as BrokerScope[],
      parsed.data.ttl_seconds,
    ),
  );
}