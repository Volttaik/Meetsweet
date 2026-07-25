import { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, notFound } from "@/lib/api/response";

async function assertAdmin(conversationId: string, userId: string) {
  const [m] = await db
    .select({ role: conversation_members.role })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, conversationId),
        eq(conversation_members.user_id, userId)
      )
    )
    .limit(1);
  return m;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { messageId } = await params;

  const [msg] = await db
    .select({ id: messages.id, conversation_id: messages.conversation_id })
    .from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deleted_at)))
    .limit(1);

  if (!msg) return notFound();

  const member = await assertAdmin(msg.conversation_id, auth.user.userId);
  if (!member) return forbidden();

  await db.update(messages).set({ is_pinned: true }).where(eq(messages.id, messageId));
  return ok(null, "Message pinned");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { messageId } = await params;

  const [msg] = await db
    .select({ id: messages.id, conversation_id: messages.conversation_id })
    .from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deleted_at)))
    .limit(1);

  if (!msg) return notFound();

  const member = await assertAdmin(msg.conversation_id, auth.user.userId);
  if (!member) return forbidden();

  await db.update(messages).set({ is_pinned: false }).where(eq(messages.id, messageId));
  return ok(null, "Message unpinned");
}
