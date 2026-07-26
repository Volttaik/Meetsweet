import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, profiles, verification_codes } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { generateId, generateVerificationCode, expiresAt } from "@/lib/auth/codes";
import { parseBody } from "@/lib/api/validate";
import { created, err } from "@/lib/api/response";
import { registerSchema } from "@/schemas/auth";
import { sendVerificationEmail } from "@/lib/services/email";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, registerSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  // Check username and email uniqueness
  const [existingEmail] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, body.email.toLowerCase()))
    .limit(1);

  if (existingEmail) return err("Email already registered", 409);

  const [existingUsername] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, body.username.toLowerCase()))
    .limit(1);

  if (existingUsername) return err("Username already taken", 409);

  const userId = generateId();
  const passwordHash = await hashPassword(body.password);

  // Create user
  await db.insert(users).values({
    id: userId,
    full_name: body.full_name,
    username: body.username.toLowerCase(),
    email: body.email.toLowerCase(),
    phone: body.phone,
    password_hash: passwordHash,
    is_verified: false,
  });

  // Create profile
  await db.insert(profiles).values({
    id: generateId(),
    user_id: userId,
    display_name: body.full_name,
  });

  // Generate verification code
  const code = generateVerificationCode();
  await db.insert(verification_codes).values({
    id: generateId(),
    user_id: userId,
    code,
    type: "email_verify",
    expires_at: expiresAt(15),
  });

  // Send verification email (best-effort)
  try {
    await sendVerificationEmail({
      to: body.email.toLowerCase(),
      name: body.full_name,
      code,
    });
  } catch (e) {
    console.error("Failed to send verification email:", e);
  }

  return created({ user_id: userId }, "Registration successful. Please verify your email.");
}
