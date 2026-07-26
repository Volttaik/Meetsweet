import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import {
  BROKER_SCOPES,
  isBrokerScope,
  issueScopedCredential,
} from "@/lib/credentials";

const schema = z.object({
  scopes: z.array(z.string()).min(1).max(BROKER_SCOPES.length),
  ttl_seconds: z.number().int().min(60).max(900).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const scopes = [...new Set(parsed.data.scopes)];
  if (!scopes.every(isBrokerScope)) {
    return err(`Unsupported scope. Allowed: ${BROKER_SCOPES.join(", ")}`, 422);
  }

  return ok(
    await issueScopedCredential(
      auth.user.userId,
      scopes,
      parsed.data.ttl_seconds,
    ),
  );
}