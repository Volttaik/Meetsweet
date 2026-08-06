import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

/**
 * GET /api/conversations/:id/background
 * Returns the caller's current background setting for this conversation.
 *
 * PUT /api/conversations/:id/background
 * Sets or clears the caller's chat background.
 * Body: { background: string | null }
 * - Pass a non-empty string (hex colour, gradient key, or image URL) to set.
 * - Pass null or "" to clear back to the default.
 */

const schema = z.object({
  background: z.string().max(500).nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [membership] = await db
    .select({ background: conversation_members.background })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, id),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!membership) return err("Conversation not found", 404);

  return ok({ background: membership.background ?? null });
}

export async function PUT(
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

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  const background = parsed.data.background ?? null;

  await db
    .update(conversation_members)
    .set({ background: background || null })
    .where(eq(conversation_members.id, membership.id));

  return ok({ background: background || null });
}
