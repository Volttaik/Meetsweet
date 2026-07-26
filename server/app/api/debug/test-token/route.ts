import { signAccessToken } from "@/lib/auth/jwt";
import { ok } from "@/lib/api/response";

/**
 * TEMPORARY — deleted immediately after broker testing.
 * GET /api/debug/test-token
 * Returns a 15-min JWT signed with the server's own secret.
 */
export async function GET() {
  const token = await signAccessToken({
    userId: "broker-test-user-001",
    role:   "user",
  });
  return ok({ token, expires_in: 900 });
}
