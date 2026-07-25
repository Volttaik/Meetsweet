import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, reports } from "@/lib/db/schema";
import { requireAuth } from "@/middleware/auth";
import { parseBody } from "@/lib/api/validate";
import { ok, notFound, err } from "@/lib/api/response";
import { generateId } from "@/lib/auth/codes";
import { z } from "zod";

const schema = z.object({
  reason: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const { username } = await params;

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), eq(users.is_active, true)))
    .limit(1);

  if (!target) return notFound("User not found");
  if (target.id === auth.user.userId) return err("Cannot report yourself", 400);

  const parsed = await parseBody(req, schema);
  if (!parsed.success) return parsed.response;

  await db.insert(reports).values({
    id: generateId(),
    reporter_id: auth.user.userId,
    entity_type: "user",
    entity_id: target.id,
    reason: parsed.data.reason,
    description: parsed.data.description,
  });

  return ok(null, "Report submitted");
}
