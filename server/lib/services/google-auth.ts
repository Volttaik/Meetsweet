import { OAuth2Client } from "google-auth-library";
import { config } from "@/lib/config";

const googleClient = new OAuth2Client();

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  displayName: string;
  picture: string | null;
}

/**
 * Verify a token issued by Google. google-auth-library validates the signature,
 * issuer, expiry, and audience; the audience list is limited to MeetSweet's
 * configured web/Android/iOS OAuth client IDs.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
  const audiences = config.google.clientIds();
  if (audiences.length === 0) {
    throw new Error("Google OAuth client IDs are not configured");
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: audiences,
  });
  const payload = ticket.getPayload();

  if (
    !payload?.sub ||
    !payload.email ||
    payload.email_verified !== true ||
    !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss ?? "")
  ) {
    throw new Error("Google identity is incomplete or not verified");
  }

  return {
    subject: payload.sub,
    email: payload.email.trim().toLowerCase(),
    displayName: payload.name?.trim() || payload.email.split("@", 1)[0],
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
