import { Resend } from "resend";
import { config } from "@/lib/config";

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    if (!config.resend.apiKey()) {
      throw new Error("RESEND_API_KEY is required");
    }
    resend = new Resend(config.resend.apiKey());
  }
  return resend;
}

const from = () => {
  const sender = config.resend.sender();
  if (!sender) throw new Error("VERIFIED_SENDER_EMAIL is required");
  return sender;
};

// ─────────────────────────────────────────────────────────────────────────────
// Crystal / glass email shell
// Uses a black background with layered white crystal facet accents.
// Works across Outlook, Gmail, Apple Mail, and mobile clients — no CSS classes,
// no backdrop-filter, no flexbox: purely inline table-based layout.
// ─────────────────────────────────────────────────────────────────────────────

function crystalShell(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MeetSweet</title>
  <!--[if mso]>
  <noscript>
    <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#050505;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Crystal background wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:#050505;background-image:
      linear-gradient(135deg,rgba(255,255,255,0.03) 0%,transparent 50%),
      linear-gradient(225deg,rgba(255,255,255,0.04) 0%,transparent 40%),
      linear-gradient(315deg,rgba(255,255,255,0.02) 0%,transparent 60%);
      min-height:100vh;">
    <tr>
      <td align="center" style="padding:48px 16px 48px 16px;">

        <!-- Card container -->
        <table width="520" cellpadding="0" cellspacing="0" border="0"
          style="max-width:520px;width:100%;">

          <!-- ── Logo row ── -->
          <tr>
            <td align="center" style="padding-bottom:40px;">
              <!-- Crystal diamond mark -->
              <table cellpadding="0" cellspacing="0" border="0" style="display:inline-table;">
                <tr>
                  <td style="padding-right:12px;vertical-align:middle;">
                    <div style="width:36px;height:36px;background:linear-gradient(135deg,#ffffff 0%,#888888 100%);
                      clip-path:polygon(50% 0%,100% 30%,100% 70%,50% 100%,0% 70%,0% 30%);
                      display:block;">
                    </div>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:26px;font-weight:800;letter-spacing:-0.5px;
                      color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                      Meet<span style="color:#aaaaaa;font-weight:400;">Sweet</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Glass card ── -->
          <tr>
            <td style="
              background:linear-gradient(145deg,rgba(255,255,255,0.07) 0%,rgba(255,255,255,0.03) 100%);
              border:1px solid rgba(255,255,255,0.12);
              border-radius:20px;
              padding:0;
              overflow:hidden;">

              <!-- Crystal top accent band -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="
                    height:3px;
                    background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.6) 40%,rgba(255,255,255,0.9) 50%,rgba(255,255,255,0.6) 60%,transparent 100%);
                    border-radius:20px 20px 0 0;">
                  </td>
                </tr>
              </table>

              <!-- Card content -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:44px 48px 48px 48px;">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td align="center" style="padding-top:36px;">
              <p style="margin:0 0 8px 0;font-size:13px;color:rgba(255,255,255,0.3);
                font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                This email was sent by MeetSweet. If you didn't request this, ignore it.
              </p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.18);
                font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                © ${new Date().getFullYear()} MeetSweet · All rights reserved
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

/** Render the large code block used in both verification and reset emails */
function codeBlock(code: string): string {
  // Split into individual digits for better visual treatment
  const digits = code.split("");
  const digitCells = digits
    .map(
      (d) =>
        `<td style="
          width:52px;height:64px;
          text-align:center;vertical-align:middle;
          background:linear-gradient(145deg,rgba(255,255,255,0.10) 0%,rgba(255,255,255,0.04) 100%);
          border:1px solid rgba(255,255,255,0.15);
          border-radius:10px;
          font-size:32px;
          font-weight:800;
          color:#ffffff;
          font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
          letter-spacing:0;">
          ${d}
        </td>`,
    )
    .join(`<td style="width:8px;"></td>`);

  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr>${digitCells}</tr>
    </table>
    <p style="margin:16px 0 0 0;font-size:13px;color:rgba(255,255,255,0.4);
      text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Press &amp; hold the code above to copy it
    </p>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification email
// ─────────────────────────────────────────────────────────────────────────────

export async function sendVerificationEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  const firstName = opts.name.split(" ")[0];

  const content = `
    <!-- Greeting -->
    <h1 style="margin:0 0 6px 0;font-size:28px;font-weight:800;color:#ffffff;
      font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:-0.5px;">
      Welcome, ${firstName}! 👋
    </h1>
    <p style="margin:0 0 36px 0;font-size:16px;color:rgba(255,255,255,0.55);
      font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:1.5;">
      Here's your verification code to activate your MeetSweet account.
    </p>

    <!-- Divider -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
      <tr>
        <td style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent);"></td>
      </tr>
    </table>

    <!-- Label -->
    <p style="margin:0 0 20px 0;font-size:11px;font-weight:700;letter-spacing:2px;
      color:rgba(255,255,255,0.35);text-align:center;text-transform:uppercase;
      font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Your Verification Code
    </p>

    <!-- Code block -->
    ${codeBlock(opts.code)}

    <!-- Expiry notice -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="
                background:rgba(255,255,255,0.06);
                border:1px solid rgba(255,255,255,0.1);
                border-radius:100px;
                padding:8px 20px;">
                <span style="font-size:13px;color:rgba(255,255,255,0.5);
                  font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                  ⏱&nbsp; Expires in <strong style="color:rgba(255,255,255,0.75);">15 minutes</strong>
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Divider -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
      <tr>
        <td style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent);"></td>
      </tr>
    </table>

    <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.3);text-align:center;
      font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:1.6;">
      Enter this code on the verification screen.<br/>
      Didn't create an account? You can safely ignore this email.
    </p>
  `;

  await getResend().emails.send({
    from: from(),
    to: opts.to,
    subject: "Your MeetSweet verification code",
    html: crystalShell(content),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Password-reset email
// ─────────────────────────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  const firstName = opts.name.split(" ")[0];

  const content = `
    <!-- Heading -->
    <h1 style="margin:0 0 6px 0;font-size:28px;font-weight:800;color:#ffffff;
      font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:-0.5px;">
      Password Reset
    </h1>
    <p style="margin:0 0 36px 0;font-size:16px;color:rgba(255,255,255,0.55);
      font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:1.5;">
      Hi ${firstName}, use the code below to reset your MeetSweet password.
    </p>

    <!-- Divider -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
      <tr>
        <td style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent);"></td>
      </tr>
    </table>

    <!-- Label -->
    <p style="margin:0 0 20px 0;font-size:11px;font-weight:700;letter-spacing:2px;
      color:rgba(255,255,255,0.35);text-align:center;text-transform:uppercase;
      font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Reset Code
    </p>

    <!-- Code block -->
    ${codeBlock(opts.code)}

    <!-- Expiry notice -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="
                background:rgba(255,255,255,0.06);
                border:1px solid rgba(255,255,255,0.1);
                border-radius:100px;
                padding:8px 20px;">
                <span style="font-size:13px;color:rgba(255,255,255,0.5);
                  font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                  ⏱&nbsp; Expires in <strong style="color:rgba(255,255,255,0.75);">15 minutes</strong>
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Divider -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
      <tr>
        <td style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent);"></td>
      </tr>
    </table>

    <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.3);text-align:center;
      font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:1.6;">
      Enter this code in the app to set a new password.<br/>
      Didn't request a reset? No action needed — your password is unchanged.
    </p>
  `;

  await getResend().emails.send({
    from: from(),
    to: opts.to,
    subject: "Reset your MeetSweet password",
    html: crystalShell(content),
  });
}
