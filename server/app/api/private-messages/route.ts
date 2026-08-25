/**
 * GET  /api/private-messages?box=inbox|outbox|waiting&before=<iso>
 *      List the authenticated user's Private Inbox, Outbox, or Waiting
 *      originals, newest first, with reply previews and attachment state.
 *      Waiting = messages from senders the recipient restricted, queued
 *      until approved. Sender-deleted threads never appear; receiver-
 *      deleted threads are hidden only from the receiver.
 *
 * POST /api/private-messages
 *      Send one paid private message to a creator.
 *      Body: { recipient_id, body, idempotency_key, attachments?: [{ media_id, media_type }] }
 *      The price is read from the creator's settings server-side; the wallet
 *      debit + message insert are atomic; retries with the same idempotency
 *      key never double-charge. Restricted senders land in Waiting.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/middleware/auth";
import { parseBody, parseQuery } from "@/lib/api/validate";
import { err, ok } from "@/lib/api/response";
import {
  listMessages,
  sendPrivateMessage,
  PrivateInboxError,
} from "@/lib/services/private-inbox";

const listQuerySchema = z.object({
  box: z.enum(["inbox", "outbox", "waiting"]).default("inbox"),
  before: z.string().optional(),
});

const attachmentSchema = z.object({
  media_id: z.string().min(1),
  media_type: z.enum(["image", "video", "file"]).default("image"),
});

const sendSchema = z.object({
  recipient_id: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
  idempotency_key: z.string().min(8).max(128),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = parseQuery(req.nextUrl.searchParams, listQuerySchema);
  if (!parsed.success) return parsed.response;

  try {
    const box = parsed.data.box ?? "inbox";
    const messages = await listMessages(auth.user.userId, box, parsed.data.before);
    return ok({ box, messages });
  } catch (error) {
    console.error("[private-messages] list failed:", error);
    return err("Could not load messages", 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, sendSchema);
  if (!parsed.success) return parsed.response;
  const { recipient_id, body, idempotency_key, attachments } = parsed.data;

  // The recipient must be a live account; the service re-checks creator +
  // inbox status authoritatively.
  const [recipient] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, recipient_id))
    .limit(1);
  if (!recipient) return err("Creator not found", 404);

  try {
    const result = await sendPrivateMessage({
      senderId: auth.user.userId,
      recipientId: recipient_id,
      body,
      idempotencyKey: idempotency_key,
      attachmentMediaIds: attachments?.map((a) => ({
        mediaId: a.media_id,
        mediaType: a.media_type,
      })),
    });
    return ok(result);
  } catch (error) {
    if (error instanceof PrivateInboxError) {
      const status =
        error.code === "NOT_FOUND" ? 404
        : error.code === "FORBIDDEN" || error.code === "BLOCKED" || error.code === "SELF_MESSAGE" ? 403
        : error.code === "INSUFFICIENT_BALANCE" ? 402
        : 400;
      return err(error.message, status, error.code);
    }
    console.error("[private-messages] send failed:", error);
    return err("Could not send the message", 500);
  }
}
