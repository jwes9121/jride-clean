import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/utils/email/sendEmail";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function text(v: unknown) {
  return String(v || "").trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = text(body?.email).toLowerCase();

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Email is required." },
        { status: 400 }
      );
    }

    const { data } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: "https://app.jride.net/reset-password",
      },
    });

    const link = data?.properties?.action_link;

    if (link) {
      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.6">
          <h2>JRide Password Reset</h2>
          <p>Click the button below to reset your password:</p>
          <p>
            <a href="${link}" style="background:#111;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;">
              Reset Password
            </a>
          </p>
          <p>If you did not request this, you can ignore this email.</p>
        </div>
      `;

      await sendEmail({
        to: email,
        subject: "JRide password reset",
        html,
        replyTo: process.env.EMAIL_REPLY_TO || "info@jride.net",
      });
    }

    return NextResponse.json({
      ok: true,
      message: "If that email exists, a reset link has been sent.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unexpected error." },
      { status: 500 }
    );
  }
}