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

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const phone_raw = String(body?.phone ?? "").trim();
    const email_raw = String(body?.email ?? "").trim();
    const password = String(body?.password ?? "").trim();

    if (!password || password.length < 6) return bad("Password must be at least 6 characters.");

    let email = "";
    let phone = "";

    if (phone_raw) {
      phone = normPhone(phone_raw);
      if (!/^\+63\d{10}$/.test(phone)) {
        return bad("Phone must be a valid PH number (e.g., 09xxxxxxxxx or +639xxxxxxxxx).");
      }
      email = phoneToInternalEmail(phone);
    } else if (email_raw) {
      email = email_raw;
    } else {
      return bad("Phone or email is required.");
    }

    // IMPORTANT: SSR cookie-aware client (writes auth cookies)
    const supabase = createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const msg = String(error.message || "Login failed.");
      const low = msg.toLowerCase();
      if (low.includes("invalid") || low.includes("credentials")) {
        return bad("Invalid phone/email or password.", 401);
      }
      return bad(msg, 401);
    }

    const userId = data?.user?.id ?? null;

    return NextResponse.json({
      ok: true,
      user_id: userId,
      phone: phone || null,
      email_used: email,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Login failed." },
      { status: 500 }
    );
  }
}
