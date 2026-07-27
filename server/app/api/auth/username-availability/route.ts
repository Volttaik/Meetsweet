import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ok, err } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username")?.trim();
  if (!username) return err("username query parameter is required", 400);
  if (username.length < 2 || username.length > 30) return err("Username must be 2–30 characters", 400);
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return err("Only letters, numbers and underscores allowed", 400);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username.toLowerCase()))
    .limit(1);

  return ok({ available: !existing, username });
}
