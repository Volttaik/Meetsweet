import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { parseQuery } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { usernameAvailabilitySchema } from "@/schemas/auth";

export async function GET(req: NextRequest) {
  const parsed = parseQuery(req.nextUrl.searchParams, usernameAvailabilitySchema);
  if (!parsed.success) return parsed.response;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, parsed.data.username.toLowerCase()))
    .limit(1);

  return ok({ available: !existing });
}
