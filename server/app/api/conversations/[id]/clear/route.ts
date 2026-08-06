import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";

/**
 * POST /api/conversations/:id/clear
 *
 * Sets cleared_at = now() on the caller's conversation_member row.
 * After this, GET /conversations and GET /conversations/:id/messages both
 * filter out any messages created before cleared_at — effectively "clearing"
 * the chat history for this user only without deleting any records.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [membership] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, id),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!membership) return err("Conversation not found", 404);

  const now = new Date().toISOString();

  await db
    .update(conversation_members)
    .set({ cleared_at: now })
    .where(eq(conversation_members.id, membership.id));

  return ok({ cleared: true, cleared_at: now });
}
