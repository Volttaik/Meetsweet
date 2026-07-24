import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { muted_users } from "@/lib/db/schema";
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

  if (user_id === auth.user.userId) return err("Cannot mute yourself", 400);

  await db.insert(muted_users).values({
    id: generateId(),
    muter_id: auth.user.userId,
    muted_id: user_id,
  }).onConflictDoNothing();

  return ok(null, "User muted");
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  await db.delete(muted_users).where(
    and(eq(muted_users.muter_id, auth.user.userId), eq(muted_users.muted_id, parsed.data.user_id))
  );

  return ok(null, "User unmuted");
}
