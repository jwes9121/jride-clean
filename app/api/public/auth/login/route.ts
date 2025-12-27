import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    const password = String(body?.password ?? "").trim();

    if (!phone_raw) return bad("Phone number is required.");
    if (!password) return bad("Password is required.");

    const phone = normPhone(phone_raw);
    if (!/^\+63\d{10}$/.test(phone)) {
      return bad("Phone must be a valid PH number (e.g., 09xxxxxxxxx or +639xxxxxxxxx).");
    }

    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";
    const ANON_KEY =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "";

    if (!SUPABASE_URL || !ANON_KEY) {
      return bad("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.", 500);
    }

    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const email = phoneToInternalEmail(phone);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return bad(error.message || "Login failed.", 401);

    return NextResponse.json({
      ok: true,
      user_id: data?.user?.id ?? null,
      phone,
      verified: (data?.user?.user_metadata as any)?.verified ?? null,
      night_allowed: (data?.user?.user_metadata as any)?.night_allowed ?? null,
      isNightPH: (() => {
        try {
          const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12:false, hour:"2-digit" });
          const hh = parseInt(dtf.format(new Date()) || "0", 10);
          return (hh >= 20) || (hh < 5);
        } catch {
          return null;
        }
      })(),
      nightRestrictedNow: (() => {
        try {
          const md: any = (data?.user?.user_metadata as any) || {};
          const v = md?.verified === true || ["1","true","yes","y","on"].includes(String(md?.verified ?? "").trim().toLowerCase());
          const na = md?.night_allowed === true || ["1","true","yes","y","on"].includes(String(md?.night_allowed ?? "").trim().toLowerCase()) || v;
          const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12:false, hour:"2-digit" });
          const hh = parseInt(dtf.format(new Date()) || "0", 10);
          const night = (hh >= 20) || (hh < 5);
          return night && !na;
        } catch {
          return null;
        }
      })(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Login failed." },
      { status: 500 }
    );
  }
}

