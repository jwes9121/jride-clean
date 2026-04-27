const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "JRide <info@jride.net>";

type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(params: SendEmailParams) {
  if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text || params.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || `RESEND_SEND_FAILED_${res.status}`);
  }

  return data;
}