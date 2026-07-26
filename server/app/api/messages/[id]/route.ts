import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

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

  // Soft-delete by recalling
  await db
    .update(messages)
    .set({ is_recalled: true, body: null, media_url: null, deleted_at: new Date().toISOString() })
    .where(eq(messages.id, id));

  return ok({ deleted: true });
}
