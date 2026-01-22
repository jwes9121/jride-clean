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

function isEmail(s: string): boolean {
  const v = String(s || "").trim();
  if (!v) return false;
  // simple safe check (pilot)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const full_name = String(body?.full_name ?? "").trim();
    const phone_raw = String(body?.phone ?? "").trim();
    const password = String(body?.password ?? "").trim();
    const role = String(body?.role ?? "passenger").trim() || "passenger";
    const address = String(body?.address ?? "").trim();
    const town = String(body?.town ?? "").trim();

    const contact_email_raw = String(body?.contact_email ?? "").trim();
    const contact_email = isEmail(contact_email_raw) ? contact_email_raw : "";

    if (!full_name) return bad("Full name is required.");
    if (!phone_raw) return bad("Phone number is required.");
    if (!password || password.length < 6) return bad("Password must be at least 6 characters.");

    const phone = normPhone(phone_raw);
    if (!/^\+63\d{10}$/.test(phone)) {
      return bad("Phone must be a valid PH number (e.g., 09xxxxxxxxx or +639xxxxxxxxx).");
    }

    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";
    const SERVICE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return bad("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on server.", 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // IMPORTANT:
    // We keep a stable internal email for password-auth using phone.
    // contact_email is stored as metadata only (pilot).
    const email = phoneToInternalEmail(phone);

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role,
        full_name,
        phone,
        address,
        town,
        contact_email: contact_email || null,
        signup_source: "web",
      },
    });

    if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
        return bad("This phone is already registered. Please login instead.", 409);
      }
      return bad(msg || "Signup failed.", 500);
    }

    return NextResponse.json({
      ok: true,
      user_id: data?.user?.id ?? null,
      phone,
      role,
      contact_email: contact_email || null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Signup failed." },
      { status: 500 }
    );
  }
}
