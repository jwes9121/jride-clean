import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const token = String(body?.token ?? "").trim();
    const newPassword = String(body?.new_password ?? "").trim();

    if (!token) {
      return bad("Reset token is required.");
    }

    if (!newPassword || newPassword.length < 6) {
      return bad("Password must be at least 6 characters.");
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

    const { data: tokenRows, error: tokenError } = await admin
      .from("password_reset_tokens")
      .select("id,user_id,token,expires_at,used")
      .eq("token", token)
      .limit(1);

    if (tokenError) {
      return bad(tokenError.message || "Unable to validate reset token.", 500);
    }

    const row = tokenRows?.[0];
    if (!row) {
      return bad("Invalid or expired reset token.", 400);
    }

    if (row.used) {
      return bad("This reset link has already been used.", 400);
    }

    const expiresAtMs = new Date(row.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
      return bad("Invalid or expired reset token.", 400);
    }

    const { error: updateUserError } = await admin.auth.admin.updateUserById(
      row.user_id,
      { password: newPassword }
    );

    if (updateUserError) {
      return bad(updateUserError.message || "Unable to reset password.", 500);
    }

    const { error: markUsedError } = await admin
      .from("password_reset_tokens")
      .update({ used: true })
      .eq("id", row.id);

    if (markUsedError) {
      return bad(markUsedError.message || "Password updated but token finalization failed.", 500);
    }

    return NextResponse.json({
      ok: true,
      message: "Password has been reset successfully."
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Reset password failed." },
      { status: 500 }
    );
  }
}