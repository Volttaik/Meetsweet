import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { blocked_users } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { z } from "zod";
import { generateId } from "@/lib/auth/codes";

const schema = z.object({ user_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;
  const { user_id } = parsed.data;

  if (user_id === auth.user.userId) return err("Cannot block yourself", 400);

  await db.insert(blocked_users).values({
    id: generateId(),
    blocker_id: auth.user.userId,
    blocked_id: user_id,
  }).onConflictDoNothing();

  return ok(null, "User blocked");
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  await db.delete(blocked_users).where(
    and(eq(blocked_users.blocker_id, auth.user.userId), eq(blocked_users.blocked_id, parsed.data.user_id))
  );

  return ok(null, "User unblocked");
}
