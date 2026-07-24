import { Resend } from "resend";

// Initialize Resend lazily so the module can be imported by health checks.
let resend: Resend | null = null;

function getResend(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY must be set to send email");
  }
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

function getFrom(): string {
  const configuredSender = process.env.RESEND_FROM_EMAIL;
  if (!configuredSender) {
    throw new Error("RESEND_FROM_EMAIL must be set to a verified sender address");
  }
  return configuredSender.includes("<")
    ? configuredSender
    : `MeetSweet <${configuredSender}>`;
}
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
    body {
      background: #080808;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #d4d4d4;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper { max-width: 580px; margin: 0 auto; padding: 48px 20px 64px; }

    /* Logo bar */
    .logo-bar { text-align: center; margin-bottom: 32px; }
    .logo-text {
      font-size: 13px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 3px;
      text-transform: uppercase;
    }

    /* Card */
    .card {
      background: #111111;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 20px;
      overflow: hidden;
    }

    /* Body */
    .body { padding: 44px 48px 40px; }

    .eyebrow {
      font-size: 11px;
      font-weight: 600;
      color: #555;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 16px;
    }
    .heading {
      font-size: 26px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.5px;
      line-height: 1.25;
      margin-bottom: 16px;
    }
    .body-text {
      font-size: 15px;
      color: #888;
      line-height: 1.7;
      margin-bottom: 0;
    }

    /* Code block */
    .code-section { margin: 36px 0; }
    .code-box {
      background: #0a0a0a;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 36px 24px;
      text-align: center;
    }
    .code {
      font-size: 44px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 14px;
      font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
      display: block;
      margin-bottom: 12px;
    }
    .code-meta {
      font-size: 12px;
      color: #444;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    /* Divider */
    .divider { height: 1px; background: rgba(255,255,255,0.06); margin: 32px 0; }

    /* Notice */
    .notice {
      font-size: 13px;
      color: #555;
      line-height: 1.65;
    }
    .notice a { color: #777; text-decoration: underline; }

    /* Feature list */
    .feature-list { list-style: none; margin: 20px 0 0; padding: 0; }
    .feature-list li {
      font-size: 14px;
      color: #777;
      line-height: 1.6;
      padding: 6px 0;
      padding-left: 18px;
      position: relative;
    }
    .feature-list li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 14px;
      width: 5px;
      height: 5px;
      background: #333;
      border-radius: 50%;
    }

    /* Footer */
    .footer {
      padding: 24px 48px 28px;
      border-top: 1px solid rgba(255,255,255,0.05);
      text-align: center;
    }
    .footer-text {
      font-size: 12px;
      color: #3a3a3a;
      line-height: 1.8;
    }
    .footer-text a { color: #4a4a4a; text-decoration: none; }
    .footer-text a:hover { text-decoration: underline; }

    @media (max-width: 620px) {
      .body { padding: 32px 28px 28px; }
      .footer { padding: 20px 28px 24px; }
      .code { font-size: 36px; letter-spacing: 10px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="logo-bar">
      <span class="logo-text">${BRAND}</span>
    </div>
    <div class="card">
      <div class="body">
        ${bodyHtml}
      </div>
      <div class="footer">
        <div class="footer-text">
          If you didn&rsquo;t request this, you can safely ignore it.<br/>
          Questions? <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
          &nbsp;&middot;&nbsp;
          &copy; ${new Date().getFullYear()} ${BRAND}
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
  const client = getResend();

  const html = buildHtml(
    "Verify your email",
    `
    <p class="eyebrow">Email Verification</p>
    <h1 class="heading">Confirm your address</h1>
    <p class="body-text">
      Hi @${username} — thanks for joining. Enter the code below to verify your email address and activate your account.
    </p>
    <div class="code-section">
      <div class="code-box">
        <span class="code">${code}</span>
        <span class="code-meta">Expires in 15 minutes</span>
      </div>
    </div>
    <div class="divider"></div>
    <p class="notice">
      This code is single-use and expires after 15 minutes. If you didn&rsquo;t create a MeetSweet account, you can safely disregard this message.
    </p>
    `,
  );

  await client.emails.send({
    from: getFrom(),
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
  const client = getResend();

  const html = buildHtml(
    "Reset your password",
    `
    <p class="eyebrow">Password Reset</p>
    <h1 class="heading">Reset your password</h1>
    <p class="body-text">
      Hi @${username} — we received a request to reset your MeetSweet password. Use the code below to continue. If you didn&rsquo;t request this, no action is needed.
    </p>
    <div class="code-section">
      <div class="code-box">
        <span class="code">${code}</span>
        <span class="code-meta">Expires in 15 minutes</span>
      </div>
    </div>
    <div class="divider"></div>
    <p class="notice">
      This code is single-use. Your password will not change unless you complete the reset flow using this code.
    </p>
    `,
  );

  await client.emails.send({
    from: getFrom(),
    to,
    subject: `${code} is your MeetSweet password reset code`,
    html,
  });
}

export async function sendWelcomeEmail(
  to: string,
  username: string,
): Promise<void> {
  const client = getResend();

  const html = buildHtml(
    "Welcome to MeetSweet",
    `
    <p class="eyebrow">Welcome Aboard</p>
    <h1 class="heading">Good to have you, @${username}.</h1>
    <p class="body-text">
      Your account is ready. We&rsquo;ve added <strong style="color:#ffffff;font-weight:600;">500 welcome credits</strong> to your balance — use them to explore exclusive content from creators you love.
    </p>
    <div class="divider"></div>
    <p class="body-text" style="margin-bottom:12px;">Here&rsquo;s what you can do on MeetSweet:</p>
    <ul class="feature-list">
      <li>Discover and follow creators across every category</li>
      <li>Access exclusive content with your credits or subscription</li>
      <li>Send direct messages to the people you follow</li>
      <li>Publish your own content and grow an audience</li>
    </ul>
    <div class="divider"></div>
    <p class="notice">
      Questions or issues? Reach us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> — we typically respond within one business day.
    </p>
    `,
  );

  await client.emails.send({
    from: getFrom(),
    to,
    subject: `Welcome to MeetSweet, @${username}`,
    html,
  });
}

export async function sendPasswordChangedEmail(
  to: string,
  username: string,
): Promise<void> {
  const client = getResend();

  const html = buildHtml(
    "Your password has been changed",
    `
    <p class="eyebrow">Security Notice</p>
    <h1 class="heading">Your password was changed</h1>
    <p class="body-text">
      Hi @${username} — this is a confirmation that your MeetSweet password was successfully updated. No further action is needed.
    </p>
    <div class="divider"></div>
    <p class="notice">
      If you didn&rsquo;t make this change, contact us immediately at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> so we can secure your account.
    </p>
    `,
  );

  await client.emails.send({
    from: getFrom(),
    to,
    subject: "Your MeetSweet password has been changed",
    html,
  });
}
