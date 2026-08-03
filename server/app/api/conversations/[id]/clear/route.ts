import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, conversation_members, messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

/**
 * DELETE /api/conversations/:id/clear
 *
 * Clear all messages in a conversation for the authenticated user.
 * This soft-deletes all messages by marking them as recalled.
 * Does not affect other participants.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  // Verify conversation exists
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  if (!conv) return err("Conversation not found", 404);

  // Verify caller is a member
  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, id),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!member) return err("Forbidden", 403);

  // Soft-delete all messages in the conversation sent by the caller
  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({
      is_recalled: true,
      body: null,
      caption: null,
      media_url: null,
      file_name: null,
      is_paid: false,
      deleted_at: now,
      updated_at: now,
    })
    .where(
      and(
        eq(messages.conversation_id, id),
        eq(messages.sender_id, auth.user.userId),
        eq(messages.is_recalled, false),
      ),
    );

  return ok({ cleared: true });
}
