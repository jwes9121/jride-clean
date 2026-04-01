import nodemailer from "nodemailer";

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  const host = process.env.SMTP_HOST || "";
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";

  if (!host || !port || !user || !pass) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: {
      user,
      pass,
    },
  });

  await transporter.sendMail({
    from: `"JRide" <${user}>`,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}