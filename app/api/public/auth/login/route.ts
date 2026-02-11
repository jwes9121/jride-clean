import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normPhone(raw: string): string {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/[^\d+]/g, "");
  let d = digits;

  if (d.startsWith("09") && d.length === 11) d = "+63" + d.slice(1);
  if (d.startsWith("63") && d.length >= 12) d = "+" + d;
  if (d.startsWith("+63") && d.length >= 13) return d;

  const onlyNums = s.replace(/[^\d]/g, "");
  if (onlyNums.length === 11 && onlyNums.startsWith("09")) return "+63" + onlyNums.slice(1);
  if (onlyNums.length === 10) return "+63" + onlyNums;

  return d;
}

function phoneToInternalEmail(phoneE164: string): string {
  const digits = phoneE164.replace(/[^\d]/g, "");
  return `p_${digits}@phone.jride.local`;
}

function isEmail(s: string): boolean {
  const v = String(s || "").trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function bad(error: string, status = 400, message?: string) {
  return NextResponse.json({ ok: false, error, message: message ?? error }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const phone_raw = String(body?.phone ?? "").trim();
    const email_raw = String(body?.email ?? "").trim();
    const password = String(body?.password ?? "").trim();

    if (!password) return bad("PASSWORD_REQUIRED", 400, "Password is required.");

    // We support either phone or email login.
    // Passenger signup uses internal email derived from phone, so phone login maps to that internal email.
    let email = "";
    if (phone_raw) {
      const phone = normPhone(phone_raw);
      if (!/^\+63\d{10}$/.test(phone)) {
        return bad("PHONE_INVALID", 400, "Phone must be a valid PH number (e.g., 09xxxxxxxxx or +639xxxxxxxxx).");
      }
      email = phoneToInternalEmail(phone);
    } else if (isEmail(email_raw)) {
      email = email_raw;
    } else {
      return bad("PHONE_OR_EMAIL_REQUIRED", 400, "Phone (recommended) or email is required.");
    }

    const supabase = createClient();

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data?.user) {
      return bad("LOGIN_FAILED", 401, error?.message || "Login failed.");
    }

    // IMPORTANT: createClient() must be the cookie-enabled server client.
    // If it is, Supabase auth cookies are set automatically on this response.
    return NextResponse.json({
      ok: true,
      user_id: data.user.id,
      email: data.user.email,
    });
  } catch (e: any) {
    return bad("LOGIN_ERROR", 500, e?.message || "Login error.");
  }
}