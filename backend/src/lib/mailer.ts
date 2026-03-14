import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@guild.com";

export async function sendMagicLinkEmail(to: string, magicLinkUrl: string): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[MAILER] SMTP not configured. Magic link for ${to}: ${magicLinkUrl}`);
    return;
  }

  await transporter.sendMail({
    from: `"Roadmap Hub" <${fromAddress}>`,
    to,
    subject: "Your Roadmap Hub Login Link",
    text: `Sign in to Roadmap Hub\n\nClick the link below to sign in. This link expires in 15 minutes.\n\n${magicLinkUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="width: 48px; height: 48px; border-radius: 12px; background: #d97706; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 20px; font-weight: bold;">R</div>
          <h1 style="font-size: 20px; font-weight: 700; color: #1c1917; margin: 16px 0 4px;">Roadmap Hub</h1>
        </div>
        <p style="font-size: 15px; color: #44403c; line-height: 1.6; margin-bottom: 24px;">Click the button below to sign in. This link expires in 15 minutes.</p>
        <div style="text-align: center; margin-bottom: 24px;">
          <a href="${magicLinkUrl}" style="display: inline-block; padding: 12px 32px; background: #d97706; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px;">Sign in to Roadmap Hub</a>
        </div>
        <p style="font-size: 12px; color: #a8a29e; line-height: 1.5;">If you didn't request this link, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 24px 0;" />
        <p style="font-size: 11px; color: #a8a29e;">This link will only work once and expires in 15 minutes.</p>
      </div>
    `,
  });

  console.log(`[MAILER] Magic link email sent to ${to}`);
}
