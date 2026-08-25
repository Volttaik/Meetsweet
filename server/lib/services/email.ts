import { Resend } from "resend";
import { config } from "@/lib/config";
import { MEETSWEET_EMAIL_LOGO_B64 } from "./email-logo";

/**
 * MeetSweet transactional email service (Resend).
 *
 * Branding: the platform gradient (amber → pink → orchid → violet, matching the
 * mobile app's AppGradients.brand) is the visual identity. The header shows the
 * MeetSweet logo — a gradient square + white heart — embedded as a Resend
 * inline image via Content-ID (cid:meetsweet-logo), with the wordmark also
 * rendered as TEXT ("Meet" white / "Sweet" hot pink) so branding survives even
 * with images blocked.
 *
 * Layout notes:
 *  - Table-based layout with inline styles only — no JavaScript, no external
 *    CSS, no features Gmail/Outlook strip (no flexbox, no clip-path).
 *  - The header uses an inline SVG data-URI gradient treatment with a solid
 *    deep-violet fallback (bgcolor + background-color) for clients that strip
 *    SVG/data-URI backgrounds — the logo + wordmark remain readable either way.
 *  - The logo is a fully opaque PNG (no alpha), so it renders correctly even in
 *    Outlook desktop, and is sent as an inline attachment (NOT a downloadable
 *    file) via Resend's inlineContentId mechanism.
 *  - Content sits on a clean white card with dark text for maximum
 *    readability; the decorative treatment stays in the header only.
 *  - Every event has its own template with the correct dynamic data — nothing
 *    is hard-coded into the shared shell.
 */

// ─── Brand tokens (platform gradient — matches mobile constants/theme.ts) ────

const PINK = "#FF1493"; // gradient stop 2 — primary CTA / wordmark accent
const ORCHID = "#B521C4"; // gradient stop 3
const VIOLET = "#800080"; // gradient stop 5 — deep end
const AMBER = "#FF8C00"; // gradient stop 1 — warm end
const INK = "#1B1B24"; // primary body text
const INK_2 = "#5C5C6B"; // secondary text
const INK_3 = "#8E8E9C"; // tertiary / labels
const PAGE_BG = "#EEEEF2"; // page background (light gray)
const CARD_BG = "#FFFFFF";
const CARD_BORDER = "#E4E4EA";
const HEADER_BG = "#160F1E"; // deep violet-charcoal header fallback
const FONT = "'Poppins','Helvetica Neue',Helvetica,Arial,sans-serif";
const COMPANY = "MeetSweet Industries";
const PRODUCT = "MeetSweet";
const LOGO_CID = "meetsweet-logo"; // Content-ID used by both HTML <img> and attachment

// ─── Provider ────────────────────────────────────────────────────────────────

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    const apiKey = config.resend.apiKey();
    if (!apiKey) throw new Error("RESEND_API_KEY is required");
    resend = new Resend(apiKey);
  }
  return resend;
}

/**
 * Sender address with a professional company display name (MeetSweet
 * Industries). The verified sending address itself comes from config and is
 * never changed here — only the display name is added when missing.
 */
export function emailSender(): string {
  const s = config.resend.sender();
  if (!s) throw new Error("VERIFIED_SENDER_EMAIL is required");
  return s.includes("<") ? s : `${COMPANY} <${s}>`;
}

/**
 * The header treatment: a deep violet-charcoal gradient with the platform
 * gradient's warm (amber) and cool (violet) glows, as an inline SVG data URI
 * (no hosted asset). Clients that render SVG backgrounds show the full
 * treatment; Gmail and Outlook desktop fall back to the solid HEADER_BG — the
 * logo image and wordmark are on top, so branding is never lost.
 */
function crystalHeaderBg(): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300">`,
    `<defs>`,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="#221832"/>`,
    `<stop offset="1" stop-color="#120C1A"/>`,
    `</linearGradient>`,
    `<radialGradient id="a" cx="96%" cy="0%" r="80%">`,
    `<stop offset="0" stop-color="${AMBER}" stop-opacity="0.20"/>`,
    `<stop offset="100%" stop-color="${AMBER}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<radialGradient id="b" cx="4%" cy="100%" r="85%">`,
    `<stop offset="0" stop-color="${VIOLET}" stop-opacity="0.38"/>`,
    `<stop offset="100%" stop-color="${VIOLET}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<radialGradient id="c" cx="50%" cy="35%" r="60%">`,
    `<stop offset="0" stop-color="${PINK}" stop-opacity="0.16"/>`,
    `<stop offset="100%" stop-color="${PINK}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `</defs>`,
    `<rect width="600" height="300" fill="url(#g)"/>`,
    `<rect width="600" height="300" fill="url(#a)"/>`,
    `<rect width="600" height="300" fill="url(#b)"/>`,
    `<rect width="600" height="300" fill="url(#c)"/>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The MeetSweet logo as a Resend inline attachment. The HTML references it with
 * <img src="cid:meetsweet-logo">; matching inlineContentId marks it as an
 * inline (not downloadable) image. Content is an embedded base64 PNG so the
 * email is fully self-contained — no hosted or signed storage URLs.
 */
export function logoAttachment(): { filename: string; content: string; contentType: string; inlineContentId: string } {
  return {
    filename: "meetsweet-logo.png",
    content: MEETSWEET_EMAIL_LOGO_B64,
    contentType: "image/png",
    inlineContentId: LOGO_CID,
  };
}

// ─── Delivery (with diagnostics) ─────────────────────────────────────────────

async function deliver(
  kind: string,
  opts: { to: string; subject: string; html: string; text: string },
): Promise<void> {
  try {
    await getResend().emails.send({
      from: emailSender(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: [logoAttachment()],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[email] failed to send ${kind} email to ${opts.to}: ${message}`);
    throw error;
  }
}

// ─── Shared components ───────────────────────────────────────────────────────

/**
 * MeetSweet-branded header band: deep violet-charcoal with platform-gradient
 * glows, holding the logo (inline CID image) plus the MeetSweet wordmark
 * ("Meet" white / "Sweet" hot pink) and a short event tagline. The wordmark is
 * text, so branding never depends on the image loading.
 */
export function crystalHeader(tagline: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td bgcolor="${HEADER_BG}" align="center"
          style="background-color:${HEADER_BG};background-image:url('${crystalHeaderBg()}');background-repeat:no-repeat;background-position:center top;background-size:cover;border-radius:20px 20px 0 0;padding:40px 24px 34px 24px;">
          <img src="cid:${LOGO_CID}" alt="${PRODUCT}" width="72" height="72"
            style="display:block;margin:0 auto 16px auto;width:72px;height:72px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
          <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:-0.8px;line-height:1.1;color:#FFFFFF;font-family:${FONT};text-align:center;">
            Meet<span style="color:${PINK};">Sweet</span>
          </p>
          <p style="margin:9px 0 0 0;font-size:11px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.5);font-family:${FONT};text-align:center;">
            ${tagline}
          </p>
        </td>
      </tr>
    </table>`;
}

function heading(text: string): string {
  return `
    <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.3;font-weight:700;color:${INK};
      font-family:${FONT};letter-spacing:-0.4px;text-align:center;">${text}</h1>`;
}

function subheading(text: string): string {
  return `
    <p style="margin:0 0 26px 0;font-size:15px;line-height:1.7;color:${INK_2};
      font-family:${FONT};text-align:center;">${text}</p>`;
}

function divider(): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px 0;">
      <tr><td style="height:1px;font-size:0;line-height:0;background-color:${CARD_BORDER};"></td></tr>
    </table>`;
}

/**
 * The verification code as clear, simple typography on a subtle light box —
 * large letter-spaced digits, not a heavy treatment.
 */
function codeBlock(code: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      <tr>
        <td align="center" style="background-color:#F5F5F8;border:1px solid ${CARD_BORDER};border-radius:14px;padding:20px 16px;">
          <p style="margin:0 0 14px 0;font-size:11px;font-weight:700;letter-spacing:2.5px;
            color:${INK_3};text-align:center;text-transform:uppercase;font-family:${FONT};">
            Your verification code
          </p>
          <p style="margin:0;font-size:40px;font-weight:700;letter-spacing:12px;line-height:1.1;
            color:${INK};font-family:${FONT};text-align:center;">${code}</p>
        </td>
      </tr>
    </table>`;
}

function codeFootnote(lines: string[]): string {
  const ps = lines
    .map(
      (l) =>
        `<p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:${INK_2};text-align:center;font-family:${FONT};">${l}</p>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
      <tr><td align="center" style="padding:0 8px;">${ps}</td></tr>
    </table>`;
}

function securityNote(text: string): string {
  return `
    <p style="margin:22px 0 0 0;font-size:13px;line-height:1.65;color:${INK_3};
      font-family:${FONT};text-align:center;padding:0 6px;">${text}</p>`;
}

/** Table-based call-to-action button (rounded, hot pink — gradient stop 2, white label). */
function button(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px auto 6px auto;">
      <tr>
        <td align="center" bgcolor="${PINK}" style="background-color:${PINK};border-radius:28px;">
          <a href="${href}" target="_blank"
            style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:28px;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

function formatMoney(amount: number, currency: string): string {
  const symbol = currency.toUpperCase() === "NGN" ? "₦" : `${currency} `;
  const [int, frac] = amount.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${symbol}${grouped}.${frac}`;
}

function amountHighlight(amount: number, currency: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px 0;">
      <tr>
        <td align="center">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:2.5px;
            color:${INK_3};text-transform:uppercase;font-family:${FONT};">Amount</p>
          <p style="margin:0;font-size:38px;font-weight:800;letter-spacing:-1px;line-height:1.1;
            color:${INK};font-family:${FONT};">${formatMoney(amount, currency)}</p>
        </td>
      </tr>
    </table>`;
}

function detailRows(rows: [string, string][]): string {
  const trs = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 0;font-size:12px;letter-spacing:1px;text-transform:uppercase;
            color:${INK_3};font-family:${FONT};">${label}</td>
          <td style="padding:10px 0;font-size:14px;font-weight:600;color:${INK};
            font-family:${FONT};text-align:right;">${value}</td>
        </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin:0 0 22px 0;border-top:1px solid ${CARD_BORDER};">
      ${trs}
    </table>`;
}

function footer(): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <p style="margin:0 0 8px 0;font-size:13px;color:${INK_3};font-family:${FONT};">
            You're receiving this email because you have a ${PRODUCT} account.
          </p>
          <p style="margin:0 0 4px 0;font-size:12px;color:${INK_3};font-family:${FONT};">
            ${COMPANY} · help@meetsweet.space
          </p>
          <p style="margin:0;font-size:12px;color:#A9A9B5;font-family:${FONT};">
            © ${new Date().getFullYear()} ${COMPANY}. All rights reserved.
          </p>
        </td>
      </tr>
    </table>`;
}

/** Full email document shell: crystal header + white content card + footer. */
function shell(opts: { preheader: string; tagline: string; content: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>${COMPANY}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Preheader preview text -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${opts.preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BG}">
    <tr>
      <td align="center" style="padding:32px 16px 40px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
          style="width:100%;max-width:600px;">

          <tr><td>${crystalHeader(opts.tagline)}</td></tr>

          <tr>
            <td bgcolor="${CARD_BG}"
              style="background-color:${CARD_BG};padding:32px 32px 28px 32px;border-left:1px solid ${CARD_BORDER};border-right:1px solid ${CARD_BORDER};">
              ${opts.content}
            </td>
          </tr>

          <tr>
            <td bgcolor="#E9E9EF"
              style="background-color:#E9E9EF;border:1px solid ${CARD_BORDER};border-top:0;border-radius:0 0 20px 20px;padding:24px 24px 26px 24px;">
              ${footer()}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Verification email ──────────────────────────────────────────────────────

export async function sendVerificationEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const code = String(opts.code).replace(/\D/g, "");

  const content = `
    ${heading("Verify your email")}
    ${subheading(
      `Hi ${firstName}, welcome to ${PRODUCT}. We received a request to verify your ${PRODUCT} account — enter the code below to finish.`,
    )}
    ${divider()}
    ${codeBlock(code)}
    ${codeFootnote([
      "Enter this code in the MeetSweet application to continue.",
      "This code expires in 15 minutes.",
      "Do not share this code with anyone.",
    ])}
    ${securityNote(
      `If you did not request this code, you can safely ignore this email — no action is needed and your account remains protected.`,
    )}
  `;

  const html = shell({
    preheader: `Your ${PRODUCT} verification code is ${code}`,
    tagline: "Account verification",
    content,
  });

  const text = [
    `${COMPANY} — Verify your email`,
    "",
    `Hi ${firstName}, welcome to ${PRODUCT}.`,
    "We received a request to verify your MeetSweet account.",
    "Enter the code below in the MeetSweet application to continue:",
    "",
    code,
    "",
    "This code expires in 15 minutes.",
    "Do not share this code with anyone.",
    "If you did not request this code, you can safely ignore this email.",
  ].join("\n");

  await deliver("verification", {
    to: opts.to,
    subject: `Your ${PRODUCT} verification code`,
    html,
    text,
  });
}

// ─── Welcome email ───────────────────────────────────────────────────────────

export async function sendWelcomeEmail(opts: {
  to: string;
  name: string;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const publicUrl = (config.app.publicUrl() ?? "https://meetsweet.space").replace(/\/+$/, "");

  const content = `
    ${heading("Welcome to MeetSweet")}
    ${subheading(
      `Hi ${firstName}, your account is verified and ready. Explore exclusive creator content, join communities, and chat privately with the creators you love.`,
    )}
    ${divider()}
    <p style="margin:0 0 8px 0;font-size:14px;line-height:1.7;color:${INK_2};text-align:center;font-family:${FONT};">
      Here's what you can do now:
    </p>
    <p style="margin:0 0 4px 0;font-size:14px;line-height:1.7;color:${INK_2};text-align:center;font-family:${FONT};">
      • Discover creators and subscribe to exclusive content
    </p>
    <p style="margin:0 0 4px 0;font-size:14px;line-height:1.7;color:${INK_2};text-align:center;font-family:${FONT};">
      • Send private messages to your favourite creators
    </p>
    <p style="margin:0;font-size:14px;line-height:1.7;color:${INK_2};text-align:center;font-family:${FONT};">
      • Support creators directly — every subscription counts
    </p>
    ${button(`${publicUrl}`, "Explore MeetSweet")}
    ${securityNote(
      `If you didn't create this account, please contact support so we can secure it.`,
    )}
  `;

  const html = shell({
    preheader: `Welcome to ${PRODUCT}, ${firstName}! Your account is ready.`,
    tagline: "You're in",
    content,
  });

  const text = [
    `${COMPANY} — Welcome to MeetSweet`,
    "",
    `Hi ${firstName}, your account is verified and ready.`,
    "",
    "Here's what you can do now:",
    "- Discover creators and subscribe to exclusive content",
    "- Send private messages to your favourite creators",
    "- Support creators directly — every subscription counts",
    "",
    "Open MeetSweet to get started.",
    "",
    "If you didn't create this account, please contact support so we can secure it.",
  ].join("\n");

  await deliver("welcome", {
    to: opts.to,
    subject: `Welcome to ${PRODUCT}, ${firstName}!`,
    html,
    text,
  });
}

// ─── Two-factor (sign-in) email ──────────────────────────────────────────────

export async function sendTwoFactorEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const code = String(opts.code).replace(/\D/g, "");

  const content = `
    ${heading("New login verification")}
    ${subheading(
      `Hi ${firstName}, someone is attempting to sign in to your ${PRODUCT} account. Use the code below to complete the sign-in.`,
    )}
    ${divider()}
    ${codeBlock(code)}
    ${codeFootnote([
      "Enter this code in the MeetSweet application to finish signing in.",
      "This code expires in 15 minutes.",
      "Do not share this code with anyone.",
    ])}
    ${securityNote(
      `If you did not attempt to sign in, do not share this code and consider changing your password immediately.`,
    )}
  `;

  const html = shell({
    preheader: `Your ${PRODUCT} sign-in code is ${code}`,
    tagline: "Security check",
    content,
  });

  const text = [
    `${COMPANY} — New login verification`,
    "",
    `Hi ${firstName}, someone is attempting to sign in to your MeetSweet account.`,
    "Enter the code below in the MeetSweet application to finish signing in:",
    "",
    code,
    "",
    "This code expires in 15 minutes.",
    "Do not share this code with anyone.",
    "If you did not attempt to sign in, do not share this code and consider changing your password immediately.",
  ].join("\n");

  await deliver("two_fa", {
    to: opts.to,
    subject: `Your ${PRODUCT} sign-in code`,
    html,
    text,
  });
}

// ─── Password reset email ────────────────────────────────────────────────────

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const code = String(opts.code).replace(/\D/g, "");

  const content = `
    ${heading("Reset your password")}
    ${subheading(
      `Hi ${firstName}, we received a request to reset the password on your ${PRODUCT} account. Use the code below to continue.`,
    )}
    ${divider()}
    ${codeBlock(code)}
    ${codeFootnote([
      "Enter this code in the MeetSweet application to set a new password.",
      "This code is intended only for your account and expires in 15 minutes.",
    ])}
    ${securityNote(
      `If you did not request a password reset, you can safely ignore this email — your account remains protected.`,
    )}
  `;

  const html = shell({
    preheader: `Your ${PRODUCT} password reset code is ${code}`,
    tagline: "Password reset",
    content,
  });

  const text = [
    `${COMPANY} — Reset your password`,
    "",
    `Hi ${firstName}, we received a request to reset the password on your MeetSweet account.`,
    "Enter the code below in the MeetSweet application to set a new password:",
    "",
    code,
    "",
    "This code is intended only for your account and expires in 15 minutes.",
    "If you did not request a password reset, you can safely ignore this email.",
  ].join("\n");

  await deliver("password_reset", {
    to: opts.to,
    subject: `Reset your ${PRODUCT} password`,
    html,
    text,
  });
}

// ─── Payment / wallet emails ─────────────────────────────────────────────────

/** Wallet funding confirmed — sent only after the backend/Paystack verification. */
export async function sendWalletDepositEmail(opts: {
  to: string;
  name: string;
  amount: number;
  currency: string;
  newBalance: number;
  reference: string;
  status?: string;
  date?: string;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const currency = opts.currency || "NGN";
  const status = opts.status || "Successful";
  const date = opts.date
    ? new Date(opts.date).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const content = `
    ${heading("Wallet funding successful")}
    ${subheading(
      `Hi ${firstName}, your ${PRODUCT} wallet has been successfully funded with ${formatMoney(opts.amount, currency)}.`,
    )}
    ${amountHighlight(opts.amount, currency)}
    ${detailRows([
      ["Reference", opts.reference],
      ["Status", status],
      ...(date ? [["Date", date] as [string, string]] : []),
      ["New balance", formatMoney(opts.newBalance, currency)],
    ])}
    ${securityNote(
      "Your funds are now available in your MeetSweet wallet. If you didn't make this payment, please contact support immediately.",
    )}
  `;

  const html = shell({
    preheader: `Your ${PRODUCT} wallet was successfully funded with ${formatMoney(opts.amount, currency)}`,
    tagline: "Wallet funding",
    content,
  });

  const text = [
    `${COMPANY} — Wallet funding successful`,
    "",
    `Hi ${firstName}, your wallet has been successfully funded with ${formatMoney(opts.amount, currency)}.`,
    `Reference: ${opts.reference}`,
    `Status: ${status}`,
    ...(date ? [`Date: ${date}`] : []),
    `New balance: ${formatMoney(opts.newBalance, currency)}`,
    "",
    "Your funds are now available in your MeetSweet wallet.",
    "If you didn't make this payment, please contact support immediately.",
  ].join("\n");

  await deliver("wallet_deposit", {
    to: opts.to,
    subject: `Your ${PRODUCT} wallet was funded with ${formatMoney(opts.amount, currency)}`,
    html,
    text,
  });
}

/** Withdrawal request received (pending payout). */
export async function sendWithdrawalRequestedEmail(opts: {
  to: string;
  name: string;
  amount: number;
  currency: string;
  bankName?: string | null;
  accountNumber?: string | null;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const currency = opts.currency || "NGN";
  const maskedAccount = opts.accountNumber
    ? `ending in ${opts.accountNumber.slice(-4)}`
    : "your saved account";

  const content = `
    ${heading("Withdrawal requested")}
    ${subheading(
      `Hi ${firstName}, we've received your request to withdraw funds from your ${PRODUCT} wallet.`,
    )}
    ${amountHighlight(opts.amount, currency)}
    ${detailRows([
      ["Destination", opts.bankName ? `${opts.bankName} ${maskedAccount}` : maskedAccount],
      ["Status", "Processing"],
    ])}
    ${securityNote(
      "Withdrawals are typically processed within 1–3 business days. If you didn't request this, contact support immediately.",
    )}
  `;

  const html = shell({
    preheader: `Your ${formatMoney(opts.amount, currency)} withdrawal request was received`,
    tagline: "Withdrawal",
    content,
  });

  const text = [
    `${COMPANY} — Withdrawal requested`,
    "",
    `Hi ${firstName}, we've received your request to withdraw ${formatMoney(opts.amount, currency)}.`,
    `Destination: ${opts.bankName ? `${opts.bankName} ${maskedAccount}` : maskedAccount}`,
    "",
    "Withdrawals are typically processed within 1–3 business days.",
    "If you didn't request this, contact support immediately.",
  ].join("\n");

  await deliver("withdrawal", {
    to: opts.to,
    subject: `Your ${formatMoney(opts.amount, currency)} withdrawal request was received`,
    html,
    text,
  });
}

// ─── Album purchase email ────────────────────────────────────────────────────

export async function sendAlbumPurchaseEmail(opts: {
  to: string;
  name: string;
  albumTitle: string;
  creatorName: string;
  amount: number;
  currency: string;
  reference: string;
  purchasedAt: string;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const currency = opts.currency || "NGN";
  const date = new Date(opts.purchasedAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const content = `
    ${heading("Purchase confirmed")}
    ${subheading(
      `Hi ${firstName}, you've unlocked “${opts.albumTitle}” by ${opts.creatorName}. It's ready to view in your album library.`,
    )}
    ${amountHighlight(opts.amount, currency)}
    ${detailRows([
      ["Album", opts.albumTitle],
      ["Creator", opts.creatorName],
      ["Reference", opts.reference],
      ["Date", date],
    ])}
    ${securityNote(
      `If you didn't make this purchase, please contact support immediately.`,
    )}
  `;

  const html = shell({
    preheader: `Your purchase of “${opts.albumTitle}” is confirmed`,
    tagline: "Purchase confirmed",
    content,
  });

  const text = [
    `${COMPANY} — Purchase confirmed`,
    "",
    `Hi ${firstName}, you've unlocked “${opts.albumTitle}” by ${opts.creatorName}.`,
    "",
    `Amount: ${formatMoney(opts.amount, currency)}`,
    `Album: ${opts.albumTitle}`,
    `Creator: ${opts.creatorName}`,
    `Reference: ${opts.reference}`,
    `Date: ${date}`,
    "",
    "Open MeetSweet to view your album.",
    "If you didn't make this purchase, please contact support immediately.",
  ].join("\n");

  await deliver("album_purchase", {
    to: opts.to,
    subject: `You unlocked “${opts.albumTitle}”`,
    html,
    text,
  });
}

// ─── Referral bonus email ────────────────────────────────────────────────────

export async function sendReferralBonusEmail(opts: {
  to: string;
  name: string;
  amount: number;
  currency: string;
  newBalance: number;
  referredUserName: string;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const currency = opts.currency || "NGN";

  const content = `
    ${heading("You received a referral bonus")}
    ${subheading(
      `Hi ${firstName}, ${opts.referredUserName} activated a creator account using your referral link — and ${formatMoney(opts.amount, currency)} has been credited to your ${PRODUCT} wallet.`,
    )}
    ${amountHighlight(opts.amount, currency)}
    ${detailRows([
      ["Bonus", formatMoney(opts.amount, currency)],
      ["New wallet balance", formatMoney(opts.newBalance, currency)],
      ["Referred user", opts.referredUserName],
    ])}
    ${securityNote(
      `Keep sharing your referral link — you earn ${formatMoney(opts.amount, currency)} every time someone you refer becomes a creator.`,
    )}
  `;

  const html = shell({
    preheader: `You received a ${formatMoney(opts.amount, currency)} referral bonus`,
    tagline: "Referral bonus",
    content,
  });

  const text = [
    `${COMPANY} — Referral bonus received`,
    "",
    `Hi ${firstName}, ${opts.referredUserName} activated a creator account using your referral link.`,
    `You received: ${formatMoney(opts.amount, currency)}`,
    `New wallet balance: ${formatMoney(opts.newBalance, currency)}`,
    "",
    "Keep sharing your referral link — you earn this bonus every time someone you refer becomes a creator.",
  ].join("\n");

  await deliver("referral_bonus", {
    to: opts.to,
    subject: `You received a ${formatMoney(opts.amount, currency)} referral bonus`,
    html,
    text,
  });
}
