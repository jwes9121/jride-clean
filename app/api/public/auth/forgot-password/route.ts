import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { sendEmail } from "@/utils/email/sendEmail";
import { matchesRecoveryAccount, recoveryLoginEmail, recoveryPhoneSuffix } from "@/lib/passenger/passwordRecovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const email = String(body?.email ?? "").trim().toLowerCase();

    if (!isEmail(email)) return bad("Valid email is required.");
    const phone = String(body?.phone ?? "").trim();
    const loginEmail = phone ? recoveryLoginEmail(phone) : null;
    if (phone && !loginEmail) return bad("Enter a valid registered Philippine mobile number.");

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
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

    const successResponse = NextResponse.json({
      ok: true,
      message: "If these details match an account, a reset link will be emailed. Your password changes only after you finish the reset.",
    });

    let matchedUser: any = null;
    let searchComplete = false;
    const perPage = 100;

    for (let page = 1; page <= 100; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return bad("Unable to request password recovery. Please try again.", 503);
      const users = data?.users || [];
      for (const user of users) {
        if (!matchesRecoveryAccount(user, email, loginEmail)) continue;
        // Older APKs may send only email. Keep that flow only when the
        // recovery mailbox identifies exactly one account; never choose first.
        if (matchedUser && matchedUser.id !== user.id) return successResponse;
        matchedUser = user;
      }
      if ((loginEmail && matchedUser) || users.length < perPage) {
        searchComplete = true;
        break;
      }
    }

    if (!searchComplete || !matchedUser) return successResponse;

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { error: insertError } = await admin.from("password_reset_tokens").insert({
      user_id: matchedUser.id,
      token,
      expires_at: expiresAt,
      used: false,
    });

    if (insertError) {
      return bad(insertError.message || "Unable to create reset token.", 500);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://app.jride.net";
    const resetLink = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const phoneSuffix = recoveryPhoneSuffix(matchedUser.email);

    await sendEmail({
      to: email,
      subject: "JRide password reset",
      html: `
        <p>Hello,</p>
        <p>We received a request to reset the password for ${phoneSuffix ? `your JRide account with mobile number ending ${phoneSuffix}` : "your JRide account"}.</p>
        <p>This link changes only that account's password. If you intended another mobile number, return to Forgot Password and enter that number with its linked email address.</p>
        <p><a href="${resetLink}">Click here to reset your password</a></p>
        <p>This link expires in 1 hour.</p>
        <p>If you did not request this, you can ignore this email.</p>
      `,
      replyTo: process.env.EMAIL_REPLY_TO || "info@jride.net",
    });

    return successResponse;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Forgot password failed." },
      { status: 500 }
    );
  }
}
