import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, verification_codes } from "@/lib/db/schema";
import { generateId, generateVerificationCode, expiresAt } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { forgotPasswordSchema } from "@/schemas/auth";
import { sendPasswordResetEmail } from "@/lib/services/email";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, forgotPasswordSchema);
  if (!parsed.success) return parsed.response;
  const { email } = parsed.data;

  // Always return success to prevent email enumeration
  const [user] = await db
    .select({ id: users.id, full_name: users.full_name })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (user) {
    const code = generateVerificationCode();
    await db.insert(verification_codes).values({
      id: generateId(),
      user_id: user.id,
      code,
      type: "password_reset",
      expires_at: expiresAt(15),
    });

    try {
      await sendPasswordResetEmail({ to: email, name: user.full_name, code });
    } catch (e) {
      console.error("Failed to send reset email:", e);
    }
  }

  return ok(null, "If that email exists, a reset code has been sent");
}
