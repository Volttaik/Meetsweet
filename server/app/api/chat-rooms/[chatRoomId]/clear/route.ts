import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat_room_members } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { ok } from "@/lib/api/response";
import { getMember } from "@/lib/services/chat-rooms";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ chatRoomId: string }> },
) {
  const auth = await requireAuth(_req);
  if ("response" in auth) return auth.response;

  const { chatRoomId } = await params;
  const member = await getMember(chatRoomId, auth.user.userId);
  if (!member) return ok({ cleared: true });

  await db
    .update(chat_room_members)
    .set({ cleared_at: new Date().toISOString() })
    .where(eq(chat_room_members.id, member.id));

  return ok({ cleared: true });
}
