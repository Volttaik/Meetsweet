/**
 * POST /api/private-messages/:id/read
 * The recipient opened the message. Persists unread → read and emits
 * `private_message.read` to the sender's realtime channel. Idempotent —
 * re-reading changes nothing.
 */

import type { NextRequest } from "next/server";
import { requireAuth } from "@/middleware/auth";
import { err, ok } from "@/lib/api/response";
import { markRead, PrivateInboxError } from "@/lib/services/private-inbox";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  try {
    await markRead(auth.user.userId, id);
    return ok({ read: true });
  } catch (error) {
    if (error instanceof PrivateInboxError && error.code === "NOT_FOUND") {
      return err("Message not found", 404);
    }
    console.error("[private-messages] markRead failed:", error);
    return err("Could not update read state", 500);
  }
}
