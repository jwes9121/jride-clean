import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { sendEmail } from "@/utils/email/sendEmail";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function isEmail(s: string): boolean {
  const v = String(s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const email = String(body?.email ?? "").trim().toLowerCase();

    if (!isEmail(email)) {
      return bad("Valid email is required.");
    }

    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      "";

    if (!supabaseUrl || !serviceKey) {
      return bad("Missing Supabase server configuration.", 500);
    }

    const admin = createAdminClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers();

    if (usersError) {
      return bad(usersError.message || "Unable to query users.", 500);
    }

    const matchedUser =
      usersData?.users?.find((u) => {
        const meta = (u.user_metadata ?? {}) as any;
        const contactEmail = String(meta.contact_email ?? "").trim().toLowerCase();
        return contactEmail === email;
      }) ?? null;

    // Non-enumerating response
    const successResponse = NextResponse.json({
      ok: true,
      message: "If that email exists, a reset link has been sent."
    });

    if (!matchedUser) {
      return successResponse;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { error: insertError } = await admin
      .from("password_reset_tokens")
      .insert({
        user_id: matchedUser.id,
        token,
        expires_at: expiresAt,
        used: false,
      });

    if (insertError) {
      return bad(insertError.message || "Unable to create reset token.", 500);
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      "https://app.jride.net";

    const resetLink = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: email,
      subject: "JRide password reset",
      html: `
        <p>Hello,</p>
        <p>We received a request to reset your JRide password.</p>
        <p><a href="${resetLink}">Click here to reset your password</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not request this, you can ignore this email.</p>
      `,
    });

    return successResponse;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Forgot password failed." },
      { status: 500 }
    );
  }
}