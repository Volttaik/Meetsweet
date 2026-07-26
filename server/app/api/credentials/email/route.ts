import { NextRequest } from "next/server";
import { Resend } from "resend";
import { requireAuth } from "@/middleware/auth";
import { ok, err } from "@/lib/api/response";
import { config } from "@/lib/config";
import { z } from "zod";

const emailSchema = z.object({
  to: z.string().email("Invalid recipient email address"),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(10000),
});

function getResend(): Resend {
  const key = config.resend.apiKey();
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

/**
 * POST /api/credentials/email
 *
 * Broker pattern for Resend — the API key never leaves this server.
 * An authenticated client submits the recipient, subject, and body;
 * the server signs the request to Resend and returns the message ID.
 *
 * Body (JSON):
 *   to      — recipient email address
 *   subject — email subject line (max 200 chars)
 *   text    — plain-text email body (max 10 000 chars)
 *
 * Response:
 *   message_id  — Resend message ID
 *   to          — recipient address echoed back
 *   subject     — subject echoed back
 *   sent_by     — userId of the authenticated caller
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("response" in auth) return auth.response;

  const sender = config.resend.sender();
  if (!sender) return err("Email sender is not configured on this broker", 503);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("Request body must be valid JSON", 400);
  }

  const parsed = emailSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => e.message).join(", ");
    return err(msg, 422);
  }

  const { to, subject, text } = parsed.data;

  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: sender,
    to,
    subject,
    text,
  });

  if (error || !data) {
    console.error("[email broker] Resend error:", error);
    return err("Failed to send email via Resend", 502);
  }

  return ok({
    message_id: data.id,
    to,
    subject,
    sent_by: auth.user.userId,
  });
}
