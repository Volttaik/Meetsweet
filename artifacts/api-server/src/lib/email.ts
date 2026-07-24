import { Resend } from "resend";

// Initialize Resend lazily to handle missing key gracefully
let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[EmailService] RESEND_API_KEY not set — emails will be logged but not sent");
    return null;
  }
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM = "MeetSweet <onboarding@resend.dev>";
const BRAND = "MeetSweet";
const SUPPORT_EMAIL = "support@meetsweet.app";

// ─── HTML template helpers ─────────────────────────────────────────────────────

function buildHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #e5e5e5; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #111111; border: 1px solid #1f1f1f; border-radius: 16px; overflow: hidden; }
    .header { background: #ffffff; padding: 28px 32px; text-align: center; }
    .header-title { font-size: 22px; font-weight: 700; color: #000000; letter-spacing: -0.5px; }
    .body { padding: 32px; }
    .greeting { font-size: 16px; color: #e5e5e5; margin-bottom: 20px; }
    .code-box { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
    .code { font-size: 40px; font-weight: 700; color: #ffffff; letter-spacing: 12px; font-family: 'Courier New', monospace; }
    .code-label { font-size: 12px; color: #666; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px; }
    .cta-btn { display: inline-block; background: #ffffff; color: #000000; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 32px; border-radius: 10px; margin: 20px 0; }
    .divider { height: 1px; background: #1f1f1f; margin: 24px 0; }
    .note { font-size: 13px; color: #666; line-height: 1.6; }
    .footer { padding: 24px 32px; border-top: 1px solid #1a1a1a; text-align: center; }
    .footer-text { font-size: 12px; color: #444; line-height: 1.6; }
    .footer-text a { color: #888; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="header-title">${BRAND}</div>
      </div>
      <div class="body">
        ${bodyHtml}
      </div>
      <div class="footer">
        <div class="footer-text">
          If you didn't request this email, you can safely ignore it.<br/>
          Need help? <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a><br/>
          &copy; ${new Date().getFullYear()} ${BRAND}. All rights reserved.
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Email senders ─────────────────────────────────────────────────────────────

export async function sendVerificationEmail(
  to: string,
  username: string,
  code: string,
): Promise<void> {
  console.log(`[EmailService] Verification code for ${to}: ${code}`);

  const client = getResend();
  if (!client) return;

  const html = buildHtml(
    "Verify your email",
    `
    <p class="greeting">Hi @${username},</p>
    <p style="color:#a0a0a0;font-size:14px;line-height:1.6;margin-bottom:8px;">
      Thanks for joining MeetSweet! Enter the code below to verify your email address.
    </p>
    <div class="code-box">
      <div class="code">${code}</div>
      <div class="code-label">Verification code · expires in 15 minutes</div>
    </div>
    <div class="divider"></div>
    <p class="note">
      This code expires in 15 minutes. If you didn't create a MeetSweet account, you can safely ignore this email.
    </p>
    `,
  );

  await client.emails.send({
    from: FROM,
    to,
    subject: `${code} is your MeetSweet verification code`,
    html,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  username: string,
  code: string,
): Promise<void> {
  console.log(`[EmailService] Password reset code for ${to}: ${code}`);

  const client = getResend();
  if (!client) return;

  const html = buildHtml(
    "Reset your password",
    `
    <p class="greeting">Hi @${username},</p>
    <p style="color:#a0a0a0;font-size:14px;line-height:1.6;margin-bottom:8px;">
      We received a request to reset your MeetSweet password. Enter the code below to continue.
    </p>
    <div class="code-box">
      <div class="code">${code}</div>
      <div class="code-label">Password reset code · expires in 15 minutes</div>
    </div>
    <div class="divider"></div>
    <p class="note">
      This code expires in 15 minutes. If you didn't request a password reset, please ignore this email — your password won't change.
    </p>
    `,
  );

  await client.emails.send({
    from: FROM,
    to,
    subject: `${code} is your MeetSweet password reset code`,
    html,
  });
}

export async function sendWelcomeEmail(
  to: string,
  username: string,
): Promise<void> {
  console.log(`[EmailService] Welcome email for ${to} (@${username})`);

  const client = getResend();
  if (!client) return;

  const html = buildHtml(
    "Welcome to MeetSweet",
    `
    <p class="greeting">Welcome to MeetSweet, @${username}! 🎉</p>
    <p style="color:#a0a0a0;font-size:14px;line-height:1.6;margin-bottom:20px;">
      Your account has been created. You've received <strong style="color:#ffffff">500 welcome credits</strong> to explore premium content from creators you love.
    </p>
    <p style="color:#a0a0a0;font-size:14px;line-height:1.6;margin-bottom:20px;">
      Here's what you can do on MeetSweet:
    </p>
    <ul style="color:#a0a0a0;font-size:14px;line-height:2;padding-left:20px;margin-bottom:20px;">
      <li>Discover exclusive content from creators</li>
      <li>Subscribe to your favorite creators</li>
      <li>Connect through direct messages</li>
      <li>Share your own content with the community</li>
    </ul>
    <div class="divider"></div>
    <p class="note">
      If you have any questions, our support team is always here to help at <a href="mailto:${SUPPORT_EMAIL}" style="color:#888;">${SUPPORT_EMAIL}</a>.
    </p>
    `,
  );

  await client.emails.send({
    from: FROM,
    to,
    subject: `Welcome to MeetSweet, @${username}! 🎉`,
    html,
  });
}

export async function sendPasswordChangedEmail(
  to: string,
  username: string,
): Promise<void> {
  console.log(`[EmailService] Password changed notification for ${to}`);

  const client = getResend();
  if (!client) return;

  const html = buildHtml(
    "Your password has been changed",
    `
    <p class="greeting">Hi @${username},</p>
    <p style="color:#a0a0a0;font-size:14px;line-height:1.6;margin-bottom:20px;">
      Your MeetSweet password was successfully changed. If you made this change, no further action is needed.
    </p>
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:16px;margin:20px 0;">
      <p style="font-size:13px;color:#666;margin:0;">
        Changed on: <strong style="color:#e5e5e5">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</strong>
      </p>
    </div>
    <div class="divider"></div>
    <p class="note">
      If you didn't make this change, please contact us immediately at <a href="mailto:${SUPPORT_EMAIL}" style="color:#888;">${SUPPORT_EMAIL}</a> so we can secure your account.
    </p>
    `,
  );

  await client.emails.send({
    from: FROM,
    to,
    subject: "Your MeetSweet password has been changed",
    html,
  });
}
