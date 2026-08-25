/**
 * POST   /api/private-messages/restrictions   { user_id }
 *        Restrict a sender: their future private messages queue in the
 *        recipient's Waiting section instead of the normal inbox. Idempotent.
 *
 * DELETE /api/private-messages/restrictions?user_id=...
 *        Allow the sender again: the restriction is lifted AND every message
 *        still waiting from them is approved into the normal inbox.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { parseBody, parseQuery } from "@/lib/api/validate";
import { err, ok } from "@/lib/api/response";
import { allowSender, restrictSender, PrivateInboxError } from "@/lib/services/private-inbox";

const bodySchema = z.object({
  user_id: z.string().min(1),
});

const querySchema = z.object({
  user_id: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.success) return parsed.response;

  try {
    await restrictSender(auth.user.userId, parsed.data.user_id);
    return ok({ restricted: true });
  } catch (error) {
    if (error instanceof PrivateInboxError) {
      return err(error.message, 403, error.code);
    }
    console.error("[private-messages] restrict failed:", error);
    return err("Could not restrict the sender", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = parseQuery(req.nextUrl.searchParams, querySchema);
  if (!parsed.success) return parsed.response;

  try {
    const { approved } = await allowSender(auth.user.userId, parsed.data.user_id);
    return ok({ restricted: false, approved });
  } catch (error) {
    console.error("[private-messages] allow failed:", error);
    return err("Could not allow the sender", 500);
  }
}
