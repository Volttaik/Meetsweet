/**
 * GET    /api/private-messages/:id — full thread (original + every reply,
 *        oldest first, with reply references and attachment state).
 *        Only a participant of the thread may view it.
 *
 * POST   /api/private-messages/:id — reply to the message `:id` (any message
 *        in a thread, so replies-to-replies stay in the same thread). Either
 *        participant may reply; replies are free. Only the creator may price
 *        reply attachments. Body: { body, attachments?, idempotency_key? }
 *        Retries with the same idempotency key never duplicate the reply.
 *
 * POST   /api/private-messages/:id/approve — the recipient approves a waiting
 *        message into their normal inbox.
 *
 * DELETE /api/private-messages/:id — delete by ownership: the SENDER deleting
 *        removes the whole thread for BOTH participants; the RECEIVER deleting
 *        hides it only from their own inbox (the sender keeps their copy).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { err, ok } from "@/lib/api/response";
import {
  approveMessage,
  deleteMessage,
  getMessageThread,
  replyToMessage,
  PrivateInboxError,
} from "@/lib/services/private-inbox";

const replySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  idempotency_key: z.string().min(8).max(128).optional(),
  attachments: z
    .array(
      z.object({
        media_id: z.string().min(1),
        media_type: z.enum(["image", "video", "file"]).default("image"),
        price: z.number().finite().min(0).max(1_000_000).optional(),
      }),
    )
    .max(10)
    .optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const thread = await getMessageThread(auth.user.userId, id);
  if (!thread) return err("Message not found", 404);
  return ok({ message: thread });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const parsed = await parseBody(req, replySchema);
  if (!parsed.success) return parsed.response;

  try {
    const { message } = await replyToMessage({
      userId: auth.user.userId,
      messageId: id,
      body: parsed.data.body,
      idempotencyKey: parsed.data.idempotency_key,
      attachments: parsed.data.attachments?.map((a) => ({
        mediaId: a.media_id,
        mediaType: a.media_type,
        price: a.price,
      })),
    });
    return ok({ message });
  } catch (error) {
    if (error instanceof PrivateInboxError) {
      const status =
        error.code === "NOT_FOUND" ? 404
        : error.code === "FORBIDDEN" ? 403
        : error.code === "REPLY_EXISTS" ? 409
        : 400;
      return err(error.message, status, error.code);
    }
    console.error("[private-messages] reply failed:", error);
    return err("Could not send the reply", 500);
  }
}

/** POST /api/private-messages/:id/approve — approve a waiting message. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  try {
    const message = await approveMessage(auth.user.userId, id);
    return ok({ message });
  } catch (error) {
    if (error instanceof PrivateInboxError) {
      const status = error.code === "NOT_FOUND" ? 404 : 403;
      return err(error.message, status, error.code);
    }
    console.error("[private-messages] approve failed:", error);
    return err("Could not approve the message", 500);
  }
}

/** DELETE /api/private-messages/:id — delete the thread by ownership. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  try {
    const result = await deleteMessage(auth.user.userId, id);
    return ok(result);
  } catch (error) {
    if (error instanceof PrivateInboxError) {
      const status = error.code === "NOT_FOUND" ? 404 : 403;
      return err(error.message, status, error.code);
    }
    console.error("[private-messages] delete failed:", error);
    return err("Could not delete the message", 500);
  }
}
