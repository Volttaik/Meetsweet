import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, verification_codes } from "@/lib/db/schema";
import { generateId, generateVerificationCode, expiresAt } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { ok, err } from "@/lib/api/response";
import { resendVerificationSchema } from "@/schemas/auth";
import { sendVerificationEmail } from "@/lib/services/email";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, resendVerificationSchema);
  if (!parsed.success) return parsed.response;
  const { email } = parsed.data;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) return err("User not found", 404);
  if (user.is_verified) return ok(null, "Email already verified");

  const code = generateVerificationCode();
  await db.insert(verification_codes).values({
    id: generateId(),
    user_id: user.id,
    code,
    type: "email_verify",
    expires_at: expiresAt(15),
  });

  try {
    await sendVerificationEmail({ to: email, name: user.full_name, code });
  } catch (e) {
    console.error("Failed to send verification email:", e);
  }

  return ok(null, "Verification email sent");
}
