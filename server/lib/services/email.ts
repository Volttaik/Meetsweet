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

export async function sendVerificationEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  await getResend().emails.send({
    from: from(),
    to: opts.to,
    subject: "Verify your MeetSweet account",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Welcome to MeetSweet, ${opts.name}!</h2>
        <p>Your verification code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;margin:24px 0;color:#6d28d9">
          ${opts.code}
        </div>
        <p>This code expires in 15 minutes.</p>
        <p>If you didn't create an account, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  code: string;
}): Promise<void> {
  await getResend().emails.send({
    from: from(),
    to: opts.to,
    subject: "Reset your MeetSweet password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Password Reset</h2>
        <p>Hi ${opts.name},</p>
        <p>Your password reset code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;margin:24px 0;color:#6d28d9">
          ${opts.code}
        </div>
        <p>This code expires in 15 minutes.</p>
        <p>If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
}
