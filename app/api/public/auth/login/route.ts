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

    const phoneRaw = String(body?.phone ?? "").trim();
    const emailRaw = String(body?.email ?? "").trim();
    const password = String(body?.password ?? "").trim();

    if (!password || password.length < 6) {
      return bad("Password must be at least 6 characters.");
    }

    let email = "";
    let phone = "";

    if (phoneRaw) {
      phone = normPhone(phoneRaw);
      if (!/^\+63\d{10}$/.test(phone)) {
        return bad("Phone must be a valid PH number.");
      }
      email = phoneToInternalEmail(phone);
    } else if (emailRaw) {
      email = emailRaw;
    } else {
      return bad("Phone or email is required.");
    }

    const supabase = createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return bad(String(error.message || "Login failed."), 401);
    }

    const user = data?.user ?? null;
    const session = data?.session ?? null;
    const accessToken = session?.access_token ?? null;

    if (!user || !accessToken) {
      return bad("Missing authenticated user or access token.", 500);
    }

    const meta = (user.user_metadata ?? {}) as any;

    const fullName =
      meta.full_name ??
      meta.name ??
      meta.display_name ??
      null;

    return NextResponse.json({
      ok: true,
      user_id: user.id,
      phone: phone || (user as any).phone || null,
      email: user.email ?? email,
      email_used: email,
      full_name: fullName,
      name: fullName,
      access_token: accessToken
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Login failed." },
      { status: 500 }
    );
  }
}