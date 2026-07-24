import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden } from "@/lib/api/response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;

  const [m] = await db.select().from(conversation_members).where(and(eq(conversation_members.conversation_id, conversationId), eq(conversation_members.user_id, auth.user.userId))).limit(1);
  if (!m) return forbidden();

  await db.update(conversation_members).set({ is_muted: true }).where(and(eq(conversation_members.conversation_id, conversationId), eq(conversation_members.user_id, auth.user.userId)));
  return ok(null, "Conversation muted");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;

  await db.update(conversation_members).set({ is_muted: false }).where(and(eq(conversation_members.conversation_id, conversationId), eq(conversation_members.user_id, auth.user.userId)));
  return ok(null, "Conversation unmuted");
}
