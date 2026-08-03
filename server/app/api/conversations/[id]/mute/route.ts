import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { conversations, conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

/**
 * PUT /api/conversations/:id/mute
 *
 * Mute or unmute a conversation for the authenticated user.
 * Body: { muted: boolean }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  if (!conv) return err("Conversation not found", 404);

  const [member] = await db
    .select({ id: conversation_members.id, is_muted: conversation_members.is_muted })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, id),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!member) return err("Forbidden", 403);

  const parsed = await parseBody(req, z.object({ muted: z.boolean() }));
  if (!parsed.success) return parsed.response;

  await db
    .update(conversation_members)
    .set({ is_muted: parsed.data.muted })
    .where(eq(conversation_members.id, member.id));

  return ok({ muted: parsed.data.muted });
}
