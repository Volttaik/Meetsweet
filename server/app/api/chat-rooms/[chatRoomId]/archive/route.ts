import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chat_room_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { getMember } from "@/lib/services/chat-rooms";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return ok({ archived: false });

  const parsed = await parseBody(req, z.object({ archived: z.boolean() }));
  if (!parsed.success) return parsed.response;

  await db
    .update(chat_room_members)
    .set({ is_archived: parsed.data.archived })
    .where(eq(chat_room_members.id, member.id));

  return ok({ archived: parsed.data.archived });
}
