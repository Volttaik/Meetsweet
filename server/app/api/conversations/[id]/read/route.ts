import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, conversation_members, messages } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

/**
 * PUT /api/conversations/:id/read
 *
 * Mark all messages in the conversation as read for the authenticated user.
 */
export async function PUT(
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

  // Get the member record
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

  // Update last_read_at to the latest message time
  const [latestMessage] = await db
    .select({ created_at: messages.created_at })
    .from(messages)
    .where(eq(messages.conversation_id, id))
    .orderBy(messages.created_at)
    .limit(1);

  const lastReadAt = latestMessage?.created_at ?? new Date().toISOString();

  await db
    .update(conversation_members)
    .set({ last_read_at: lastReadAt })
    .where(eq(conversation_members.id, member.id));

  return ok({ marked_read: true, last_read_at: lastReadAt });
}
