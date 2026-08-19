import { Resend } from "resend";
import { config } from "@/lib/config";

/**
 * MeetSweet transactional email service (Resend).
 *
 * Branding: emails are professional company communications from MeetSuite
 * Industries (the company behind MeetSweet). The identity mark is the
 * white/black silhouette — rendered as an INLINE SVG data URI (no dependency
 * on a hosted raster image), with a hosted-PNG fallback for Outlook (mso) and
 * the wordmark as plain text so the brand survives even with images blocked.
 *
 * Layout notes:
 *  - Table-based layout with inline styles only — no JavaScript, no external
 *    CSS, no features Gmail/Outlook strip (no clip-path, no flexbox).
 *  - Background: an inline SVG data-URI treatment with a solid-color
 *    fallback for clients that strip SVG/data-URI backgrounds.
 *  - Verification codes are presented with simple, clear typography — not a
 *    heavy boxed design.
 */

// ─── Brand tokens ────────────────────────────────────────────────────────────

const ACCENT = "#C45A72";
const BG = "#0C0C0F";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "#FFFFFF";
const TEXT_2 = "rgba(255,255,255,0.62)";
const TEXT_3 = "rgba(255,255,255,0.38)";
const FONT = "'Poppins','Helvetica Neue',Helvetica,Arial,sans-serif";
const COMPANY = "MeetSuite Industries";
const PRODUCT = "MeetSweet";

/**
 * The MeetSweet silhouette (white/black logo) traced from the app's
 * `assets/images/logo.png` as a filled vector path. Rendered white on the
 * email's dark background. viewBox matches the logo's content bounding box.
 */
const LOGO_PATH =
  "M477,29L449,33L426,44L399,70L392,86L394,126L404,127L398,155L402,167L410,168L414,187L420,188L420,208L465,209L462,225L442,244L404,247L388,278L388,330L400,331L406,359L376,461L373,543L378,615L391,617L391,656L404,657L415,700L414,800L400,849L378,894L336,952L297,984L296,1002L649,1002L649,997L762,977L765,963L765,953L720,948L668,917L637,880L612,831L588,800L644,798L644,781L654,777L656,758L654,708L645,698L670,696L670,663L641,632L632,586L608,565L585,555L672,554L676,362L664,351L670,350L670,339L677,335L676,261L672,240L660,229L681,228L682,198L671,184L650,183L661,176L661,158L596,154L580,132L571,96L551,58L523,37L497,29Z";

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

/** Sender address with a professional company display name. */
function sender(): string {
  const s = config.resend.sender();
  if (!s) throw new Error("VERIFIED_SENDER_EMAIL is required");
  return s.includes("<") ? s : `${COMPANY} <${s}>`;
}

/** Absolute URL of the hosted logo PNG — used only as the Outlook (mso) fallback. */
function logoUrl(): string {
  const base = (config.app.publicUrl() ?? "https://meetsweet.space").replace(/\/+$/, "");
  return `${base}/meetsweet-logo.png`;
}

/** The silhouette as an inline SVG data URI (primary brand mark). */
function logoDataUri(): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="296 29 469 973" width="40" height="40">`,
    `<path d="${LOGO_PATH}" fill="#FFFFFF"/>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Inline SVG background (soft accent glows) as a data URI. Clients that render
 * SVG backgrounds (Apple Mail, modern Outlook, etc.) show the treatment;
 * clients that strip data-URI/SVG backgrounds (Gmail) fall back to the solid
 * dark background color.
 */
function svgBackground(): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">`,
    `<rect width="1200" height="720" fill="${BG}"/>`,
    `<defs>`,
    `<radialGradient id="glowA" cx="50%" cy="0%" r="85%">`,
    `<stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.18"/>`,
    `<stop offset="60%" stop-color="${ACCENT}" stop-opacity="0.05"/>`,
    `<stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<radialGradient id="glowB" cx="92%" cy="100%" r="75%">`,
    `<stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.16"/>`,
    `<stop offset="100%" stop-color="#8B5CF6" stop-opacity="0"/>`,
    `</radialGradient>`,
    `</defs>`,
    `<rect width="1200" height="720" fill="url(#glowA)"/>`,
    `<rect width="1200" height="720" fill="url(#glowB)"/>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ─── Delivery (with diagnostics) ─────────────────────────────────────────────

async function deliver(
  kind: string,
  opts: { to: string; subject: string; html: string; text: string },
): Promise<void> {
  try {
    await getResend().emails.send({
      from: sender(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[email] failed to send ${kind} email to ${opts.to}: ${message}`);
    throw error;
  }
}

// ─── Shared components ───────────────────────────────────────────────────────

/**
 * Company header: inline SVG silhouette + wordmark. Non-Outlook clients get
 * the inline vector (no hosted dependency); Outlook gets the hosted PNG via an
 * mso conditional; the wordmark is text, so branding is never lost.
 */
function logoHeader(): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 36px auto;">
      <tr>
        <td style="width:40px;height:40px;vertical-align:middle;text-align:center;">
          <!--[if !mso]><!-->
          <img src="${logoDataUri()}" alt="${COMPANY}" width="40" height="40"
            style="display:block;width:40px;height:40px;border:0;outline:none;text-decoration:none;" />
          <!--<![endif]-->
          <!--[if mso]>
          <img src="${logoUrl()}" alt="${COMPANY}" width="40" height="40"
            style="display:block;width:40px;height:40px;border-radius:10px;background-color:#FFFFFF;border:0;" />
          <![endif]-->
        </td>
        <td style="padding-left:12px;vertical-align:middle;">
          <span style="font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${TEXT};">
            MeetSuite <span style="color:${ACCENT};">Industries</span>
          </span>
        </td>
      </tr>
    </table>`;
}

function heading(text: string): string {
  return `
    <h1 style="margin:0 0 10px 0;font-size:25px;line-height:1.25;font-weight:700;color:${TEXT};
      font-family:${FONT};letter-spacing:-0.4px;text-align:center;">${text}</h1>`;
}

function subheading(text: string): string {
  return `
    <p style="margin:0 0 30px 0;font-size:15px;line-height:1.65;color:${TEXT_2};
      font-family:${FONT};text-align:center;">${text}</p>`;
}

function divider(): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px 0;">
      <tr><td style="height:1px;font-size:0;line-height:0;background-color:${BORDER};"></td></tr>
    </table>`;
}

/**
 * The verification code as clear, simple typography — a large letter-spaced
 * number with generous spacing, NOT a heavy boxed treatment.
 */
function codeBlock(code: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">
      <tr>
        <td align="center" style="padding:8px 0 6px 0;">
          <p style="margin:0 0 16px 0;font-size:11px;font-weight:700;letter-spacing:3px;
            color:${TEXT_3};text-align:center;text-transform:uppercase;font-family:${FONT};">
            Your verification code
          </p>
          <p style="margin:0;font-size:44px;font-weight:700;letter-spacing:14px;line-height:1.15;
            color:${TEXT};font-family:${FONT};text-align:center;">${code}</p>
        </td>
      </tr>
    </table>`;
}

function codeFootnote(lines: string[]): string {
  const ps = lines
    .map(
      (l) =>
        `<p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:${TEXT_2};text-align:center;font-family:${FONT};">${l}</p>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px 0;">
      <tr><td align="center" style="padding:0 16px;">${ps}</td></tr>
    </table>`;
}

function securityNote(text: string): string {
  return `
    <p style="margin:26px 0 0 0;font-size:13px;line-height:1.65;color:${TEXT_3};
      font-family:${FONT};text-align:center;padding:0 12px;">${text}</p>`;
}

function footer(): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:36px;">
      <tr>
        <td align="center">
          <p style="margin:0 0 8px 0;font-size:13px;color:${TEXT_3};font-family:${FONT};">
            You're receiving this email because you have a ${PRODUCT} account.
          </p>
          <p style="margin:0 0 4px 0;font-size:12px;color:rgba(255,255,255,0.28);font-family:${FONT};">
            ${COMPANY} · help@meetsweet.space
          </p>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.20);font-family:${FONT};">
            © ${new Date().getFullYear()} ${COMPANY}. All rights reserved.
          </p>
        </td>
      </tr>
    </table>`;
}

/** Full email document shell. */
function shell(opts: { preheader: string; content: string }): string {
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
<body style="margin:0;padding:0;background-color:${BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Preheader preview text -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${opts.preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <!-- Designed background: SVG treatment + solid dark fallback -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:${BG};background-image:url('${svgBackground()}');background-repeat:no-repeat;background-position:top center;background-size:cover;">
    <tr>
      <td align="center" style="padding:44px 16px 48px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
          style="width:100%;max-width:600px;">

          <tr><td>${logoHeader()}</td></tr>

          <tr>
            <td style="padding:8px 8px 0 8px;">
              ${opts.content}
            </td>
          </tr>

          <tr><td>${footer()}</td></tr>

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
      `Hi ${firstName}, welcome to ${PRODUCT}. Enter the code below to activate your account.`,
    )}
    ${divider()}
    ${codeBlock(code)}
    ${codeFootnote([
      "This code expires in 15 minutes.",
      "Do not share this code with anyone.",
    ])}
    ${securityNote(
      `If you didn't create a ${PRODUCT} account, you can safely ignore this email — no action is needed.`,
    )}
  `;

  const html = shell({
    preheader: `Your ${PRODUCT} verification code is ${code}`,
    content,
  });

  const text = [
    `${COMPANY} — Verify your email`,
    "",
    `Hi ${firstName}, welcome to ${PRODUCT}.`,
    "Enter the code below to activate your account:",
    "",
    code,
    "",
    "This code expires in 15 minutes.",
    "Do not share this code with anyone.",
    `If you didn't create a ${PRODUCT} account, you can safely ignore this email.`,
  ].join("\n");

  await deliver("verification", {
    to: opts.to,
    subject: `Your ${PRODUCT} verification code`,
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
    ${heading("Your sign-in code")}
    ${subheading(
      `Hi ${firstName}, enter the code below to finish signing in to your ${PRODUCT} account.`,
    )}
    ${divider()}
    ${codeBlock(code)}
    ${codeFootnote([
      "This code expires in 15 minutes.",
      "Do not share this code with anyone.",
    ])}
    ${securityNote(
      `If you didn't try to sign in to your ${PRODUCT} account, someone may have your password. Change it immediately and contact support.`,
    )}
  `;

  const html = shell({
    preheader: `Your ${PRODUCT} sign-in code is ${code}`,
    content,
  });

  const text = [
    `${COMPANY} — Your sign-in code`,
    "",
    `Hi ${firstName}, enter the code below to finish signing in:`,
    "",
    code,
    "",
    "This code expires in 15 minutes.",
    "Do not share this code with anyone.",
    "If you didn't try to sign in, someone may have your password — change it immediately.",
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
      `Hi ${firstName}, use the code below to set a new password for your ${PRODUCT} account.`,
    )}
    ${divider()}
    ${codeBlock(code)}
    ${codeFootnote([
      "This code expires in 15 minutes.",
      "Do not share this code with anyone.",
    ])}
    ${securityNote(
      "Didn't request a password reset? No action needed — your password is unchanged.",
    )}
  `;

  const html = shell({
    preheader: `Your ${PRODUCT} password reset code is ${code}`,
    content,
  });

  const text = [
    `${COMPANY} — Reset your password`,
    "",
    `Hi ${firstName}, use the code below to set a new password:`,
    "",
    code,
    "",
    "This code expires in 15 minutes.",
    "Do not share this code with anyone.",
    "If you didn't request a reset, no action is needed — your password is unchanged.",
  ].join("\n");

  await deliver("password_reset", {
    to: opts.to,
    subject: `Reset your ${PRODUCT} password`,
    html,
    text,
  });
}

// ─── Payment / wallet emails ─────────────────────────────────────────────

function formatMoney(amount: number, currency: string): string {
  const symbol = currency.toUpperCase() === "NGN" ? "₦" : `${currency} `;
  const [int, frac] = amount.toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${symbol}${grouped}.${frac}`;
}

function amountHighlight(amount: number, currency: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
      <tr>
        <td align="center">
          <p style="margin:0 0 10px 0;font-size:11px;font-weight:700;letter-spacing:2.5px;
            color:${TEXT_3};text-transform:uppercase;font-family:${FONT};">Amount</p>
          <p style="margin:0;font-size:40px;font-weight:800;letter-spacing:-1px;line-height:1.1;
            color:${TEXT};font-family:${FONT};">${formatMoney(amount, currency)}</p>
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
            color:${TEXT_3};font-family:${FONT};">${label}</td>
          <td style="padding:10px 0;font-size:14px;font-weight:600;color:${TEXT};
            font-family:${FONT};text-align:right;">${value}</td>
        </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin:0 0 24px 0;border-top:1px solid ${BORDER};">
      ${trs}
    </table>`;
}

/** Wallet top-up confirmed. */
export async function sendWalletDepositEmail(opts: {
  to: string;
  name: string;
  amount: number;
  currency: string;
  newBalance: number;
}): Promise<void> {
  const firstName = (opts.name || opts.to).split(" ")[0];
  const currency = opts.currency || "NGN";

  const content = `
    ${heading("Wallet topped up")}
    ${subheading(
      `Hi ${firstName}, your ${PRODUCT} wallet has been credited successfully.`,
    )}
    ${amountHighlight(opts.amount, currency)}
    ${detailRows([
      ["New balance", formatMoney(opts.newBalance, currency)],
      ["Method", "Paystack"],
    ])}
    ${securityNote(
      "If you didn't make this payment, please contact support immediately.",
    )}
  `;

  const html = shell({
    preheader: `Your ${PRODUCT} wallet was credited with ${formatMoney(opts.amount, currency)}`,
    content,
  });

  const text = [
    `${COMPANY} — Wallet topped up`,
    "",
    `Hi ${firstName}, your wallet has been credited with ${formatMoney(opts.amount, currency)}.`,
    `New balance: ${formatMoney(opts.newBalance, currency)}`,
    "",
    "If you didn't make this payment, please contact support immediately.",
  ].join("\n");

  await deliver("wallet_deposit", {
    to: opts.to,
    subject: `Your ${PRODUCT} wallet was topped up with ${formatMoney(opts.amount, currency)}`,
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
