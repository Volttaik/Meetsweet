import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { conversationId } = await params;

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) return err("Conversation not found", 404);

  const [member] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, conversationId),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!member) return err("Forbidden", 403);

  // Update last_read_at to mark all messages as read
  await db
    .update(conversation_members)
    .set({ last_read_at: new Date().toISOString() })
    .where(eq(conversation_members.id, member.id));

  return ok({ read: true });
}
