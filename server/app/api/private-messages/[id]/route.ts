/**
 * GET  /api/private-messages/:id — full thread (original + reply + attachments).
 *        Only the sender or the recipient may view it.
 *
 * POST /api/private-messages/:id — creator's reply to a message in their inbox.
 *        Body: { body, attachments?: [{ media_id, media_type, price? }] }
 *        One reply per message; only the recipient-creator may reply; prices
 *        on attachments are honored as provided BY THE CREATOR for THEIR OWN
 *        media (the reverse of sending, where the price is server-resolved).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { err, ok } from "@/lib/api/response";
import {
  getMessageThread,
  replyToMessage,
  PrivateInboxError,
} from "@/lib/services/private-inbox";

const replySchema = z.object({
  body: z.string().trim().min(1).max(5000),
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
      creatorId: auth.user.userId,
      messageId: id,
      body: parsed.data.body,
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
