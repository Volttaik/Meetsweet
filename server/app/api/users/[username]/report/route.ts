import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, reports } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { notifyReported } from "@/lib/services/notifications";

const schema = z.object({
  reason: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { username } = await params;

  // Deleted / deactivated accounts cannot be reported (and are not resolvable
  // by their original username — a hard-deleted account's row is gone).
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), eq(users.is_active, true), isNull(users.deleted_at)))
    .limit(1);

  if (!target) return err("User not found", 404);
  if (target.id === auth.user.userId) return err("You cannot report yourself", 400);

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  await db.insert(reports).values({
    id: generateId(),
    reporter_id: auth.user.userId,
    entity_type: "user",
    entity_id: target.id,
    reason: parsed.data.reason,
    description: parsed.data.description ?? null,
  });

  // The reported account learns it was reported — without any information
  // about who reported (no actor, no username, no push reference).
  void notifyReported({
    recipientId: target.id,
    reporterId: auth.user.userId,
    entityType: "user",
    entityId: target.id,
  });

  return ok({ reported: true });
}
