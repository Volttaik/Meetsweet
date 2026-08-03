import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { messages, conversation_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";

/**
 * Reactions are stored as a JSON array on messages.reactions:
 * [ { emoji: string, user_ids: string[] }, ... ]
 *
 * POST /api/messages/:id/reactions
 * Body: { emoji: string }
 *
 * Toggles the calling user's reaction with the given emoji.
 * - If they haven't reacted with this emoji: adds them.
 * - If they have already reacted: removes them (toggle).
 *
 * Returns the updated reactions array in both snake_case and camelCase
 * formats so the mobile normalizer can handle either.
 */

interface Reaction {
  emoji: string;
  user_ids: string[];
  userIds: string[];
}

function parseReactions(raw: string | null): Reaction[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r: { emoji: string; user_ids?: string[]; userIds?: string[] }) => ({
      emoji: r.emoji,
      user_ids: r.user_ids ?? r.userIds ?? [],
      userIds: r.user_ids ?? r.userIds ?? [],
    }));
  } catch {
    return [];
  }
}

function serializeReactions(reactions: Reaction[]): string {
  return JSON.stringify(
    reactions.map((r) => ({ emoji: r.emoji, user_ids: r.user_ids })),
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  // Fetch message and verify conversation membership
  const [message] = await db
    .select({
      id: messages.id,
      conversation_id: messages.conversation_id,
      reactions: messages.reactions,
      is_recalled: messages.is_recalled,
    })
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1);

  if (!message) return err("Message not found", 404);
  if (message.is_recalled) return err("Cannot react to a deleted message", 400);

  const [membership] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, message.conversation_id),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!membership) return err("Forbidden", 403);

  const parsed = await parseBody(req, z.object({ emoji: z.string().min(1).max(10) }));
  if (!parsed.success) return parsed.response;

  const { emoji } = parsed.data;
  const userId = auth.user.userId;

  const reactions = parseReactions(message.reactions);

  // Toggle: add if not present, remove if already reacted
  const existingIdx = reactions.findIndex((r) => r.emoji === emoji);
  if (existingIdx !== -1) {
    const alreadyIn = reactions[existingIdx].user_ids.includes(userId);
    if (alreadyIn) {
      // Remove user from this emoji
      const updated = reactions[existingIdx].user_ids.filter((uid) => uid !== userId);
      if (updated.length === 0) {
        reactions.splice(existingIdx, 1);
      } else {
        reactions[existingIdx].user_ids = updated;
        reactions[existingIdx].userIds = updated;
      }
    } else {
      reactions[existingIdx].user_ids.push(userId);
      reactions[existingIdx].userIds.push(userId);
    }
  } else {
    reactions.push({ emoji, user_ids: [userId], userIds: [userId] });
  }

  await db
    .update(messages)
    .set({ reactions: serializeReactions(reactions) })
    .where(eq(messages.id, id));

  return ok({ reactions });
}

/**
 * DELETE /api/messages/:id/reactions
 * Body: { emoji: string }
 *
 * Explicitly removes the calling user's reaction for the given emoji.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;

  const [message] = await db
    .select({
      id: messages.id,
      conversation_id: messages.conversation_id,
      reactions: messages.reactions,
    })
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1);

  if (!message) return err("Message not found", 404);

  const [membership] = await db
    .select({ id: conversation_members.id })
    .from(conversation_members)
    .where(
      and(
        eq(conversation_members.conversation_id, message.conversation_id),
        eq(conversation_members.user_id, auth.user.userId),
      ),
    )
    .limit(1);

  if (!membership) return err("Forbidden", 403);

  const parsed = await parseBody(req, z.object({ emoji: z.string().min(1).max(10) }));
  if (!parsed.success) return parsed.response;

  const { emoji } = parsed.data;
  const userId = auth.user.userId;

  const reactions = parseReactions(message.reactions);
  const idx = reactions.findIndex((r) => r.emoji === emoji);
  if (idx !== -1) {
    const updated = reactions[idx].user_ids.filter((uid) => uid !== userId);
    if (updated.length === 0) {
      reactions.splice(idx, 1);
    } else {
      reactions[idx].user_ids = updated;
      reactions[idx].userIds = updated;
    }
  }

  await db
    .update(messages)
    .set({ reactions: serializeReactions(reactions) })
    .where(eq(messages.id, id));

  return ok({ reactions });
}
