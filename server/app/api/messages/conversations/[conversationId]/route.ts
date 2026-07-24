import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden, notFound } from "@/lib/api/response";

async function assertMember(conversationId: string, userId: string) {
  const [m] = await db
    .select()
    .from(conversation_members)
    .where(and(eq(conversation_members.conversation_id, conversationId), eq(conversation_members.user_id, userId)))
    .limit(1);
  return m ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;

  const member = await assertMember(conversationId, auth.user.userId);
  if (!member) return forbidden();

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conv) return notFound();

  const members = await db.select({ user_id: conversation_members.user_id, role: conversation_members.role }).from(conversation_members).where(eq(conversation_members.conversation_id, conversationId));

  return ok({ ...conv, members, membership: member });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;

  const member = await assertMember(conversationId, auth.user.userId);
  if (!member) return forbidden();

  await db.delete(conversation_members).where(and(eq(conversation_members.conversation_id, conversationId), eq(conversation_members.user_id, auth.user.userId)));

  return ok(null, "Left conversation");
}
