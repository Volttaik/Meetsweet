import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversation_members, messages, message_reads } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, forbidden } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;

  const [member] = await db.select().from(conversation_members).where(and(eq(conversation_members.conversation_id, conversationId), eq(conversation_members.user_id, auth.user.userId))).limit(1);
  if (!member) return forbidden();

  const now = new Date().toISOString();
  await db.update(conversation_members).set({ last_read_at: now }).where(and(eq(conversation_members.conversation_id, conversationId), eq(conversation_members.user_id, auth.user.userId)));

  return ok(null, "Marked as read");
}
