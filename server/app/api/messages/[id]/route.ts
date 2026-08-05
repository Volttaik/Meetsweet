import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

const editSchema = z.object({
  body: z.string().min(1).max(4000),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [message] = await db
    .select({ id: messages.id, sender_id: messages.sender_id, is_recalled: messages.is_recalled })
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1);

  if (!message) return err("Message not found", 404);
  if (message.sender_id !== auth.user.userId) return err("Forbidden", 403);
  if (message.is_recalled) return err("Cannot edit a deleted message", 400);

  const parsed = await parseBody(req, editSchema);
  if (!parsed.success) return parsed.response;

  await db
    .update(messages)
    .set({
      body: parsed.data.body,
      is_edited: true,
      updated_at: new Date().toISOString(),
    })
    .where(eq(messages.id, id));

  return ok({ edited: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [message] = await db
    .select({ id: messages.id, sender_id: messages.sender_id })
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1);

  if (!message) return err("Message not found", 404);
  if (message.sender_id !== auth.user.userId) return err("Forbidden", 403);

  // Soft-delete by recalling — clears sensitive content
  await db
    .update(messages)
    .set({
      is_recalled: true,
      body: null,
      caption: null,
      media_url: null,
      file_name: null,
      deleted_at: new Date().toISOString(),
    })
    .where(eq(messages.id, id));

  return ok({ deleted: true });
}
