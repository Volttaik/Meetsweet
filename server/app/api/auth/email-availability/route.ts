import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ok, err } from "@/lib/api/response";

// Loose but practical email shape check (mirrors zod's z.string().email()
// behaviour closely enough for a live-availability hint — the register route
// still enforces the authoritative schema).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return err("email query parameter is required", 400);
  if (!EMAIL_RE.test(email)) return err("Invalid email address", 400);

  // Mirror the register route's duplicate check: only LIVE accounts block a
  // re-registration (soft-deleted accounts free their email).
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deleted_at)))
    .limit(1);

  return ok({ available: !existing, email });
}
