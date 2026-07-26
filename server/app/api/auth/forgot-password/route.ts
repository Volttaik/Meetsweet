import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, verification_codes } from "@/lib/db/schema";
import { parseBody } from "@/lib/api/validate";
import { ok } from "@/lib/api/response";
import { generateId, generateVerificationCode, expiresAt } from "@/lib/auth/codes";
import { sendPasswordResetEmail } from "@/lib/services/email";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, z.object({ email: z.string().email() }));
  if (!parsed.success) return parsed.response;

  const { email } = parsed.data;

  // Always respond the same to avoid enumeration
  const [user] = await db.select({ id: users.id, full_name: users.full_name }).from(users).where(eq(users.email, email)).limit(1);

  if (user) {
    const code = generateVerificationCode();
    await db.insert(verification_codes).values({
      id: generateId(),
      user_id: user.id,
      code,
      type: "password_reset",
      expires_at: expiresAt(15),
    });

    await sendPasswordResetEmail({
      to: email,
      name: email,
      code,
    }).catch(() => null); // swallow email errors — code is stored in DB
  }

  return ok({ message: "If an account exists for that email, a reset code has been sent." });
}
