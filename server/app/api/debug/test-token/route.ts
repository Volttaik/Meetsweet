import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/auth/jwt";
import { ok, err } from "@/lib/api/response";

/**
 * TEMPORARY — remove after broker testing is complete.
 *
 * GET /api/debug/test-token?key=<SESSION_SECRET>
 * Issues a 15-min JWT signed with the server's own secret so broker
 * endpoints can be tested without a live user account.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const expected = process.env.SESSION_SECRET ?? process.env.JWT_SECRET;
  if (!key || !expected || key !== expected) {
    return err("Forbidden", 403);
  }

  const token = await signAccessToken({
    userId: "broker-test-user-001",
    role:   "user",
  });

  return ok({ token, expires_in: 900 });
}
