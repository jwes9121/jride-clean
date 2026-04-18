import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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
  return NextResponse.json(
    { ok: false, error: msg },
    { status, headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

function cleanDeviceId(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

function cleanPlatform(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  return s || "android";
}

function cleanAppVersion(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

function cleanDeviceLabel(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

function createAnonSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createSupabaseClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function computeVerified(supabase: any, user: any): Promise<boolean> {
  if (!user?.id) return false;

  try {
    const pv = await supabase
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    const st = String((pv?.data as any)?.status ?? "").toLowerCase().trim();
    if (st) return st === "approved_admin" || st === "approved" || st === "verified";
  } catch {}

  try {
    const pr = await supabase
      .from("passenger_verification_requests")
      .select("status")
      .eq("passenger_id", user.id)
      .maybeSingle();

    const st = String((pr?.data as any)?.status ?? "").toLowerCase().trim();
    if (st) return st === "approved_admin" || st === "approved" || st === "verified";
  } catch {}

  try {
    const email = user?.email ?? null;
    const userId = user.id;

    const truthy = (v: unknown) =>
      v === true ||
      (typeof v === "number" && v > 0) ||
      (typeof v === "string" &&
        v.trim() !== "" &&
        v.trim().toLowerCase() !== "false" &&
        v.trim().toLowerCase() !== "0" &&
        v.trim().toLowerCase() !== "no");

    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase
        .from("passengers")
        .select("is_verified,verified,verification_tier,night_allowed")
        .eq(col, val)
        .limit(1)
        .maybeSingle();

      if (!r?.error && r?.data) {
        const row: any = r.data;
        return (
          truthy(row.is_verified) ||
          truthy(row.verified) ||
          truthy(row.verification_tier) ||
          truthy(row.night_allowed)
        );
      }
    }
  } catch {}

  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const phoneRaw = String(body?.phone ?? "").trim();
    const emailRaw = String(body?.email ?? "").trim();
    const password = String(body?.password ?? "").trim();

    const deviceId = cleanDeviceId(body?.device_id);
    const platform = cleanPlatform(body?.platform);
    const appVersion = cleanAppVersion(body?.app_version);
    const deviceLabel = cleanDeviceLabel(body?.device_label);

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

    const cookieSupabase = createClient();

    const { data, error } = await cookieSupabase.auth.signInWithPassword({
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

    const rpcSupabase = createAnonSupabase();

    let claim: any = null;
    let promoEnsure: any = null;

    if (deviceId) {
      const claimRes = await rpcSupabase.rpc("jride_passenger_claim_device_session", {
        p_user_id: user.id,
        p_device_id: deviceId,
        p_platform: platform,
        p_app_version: appVersion,
        p_device_label: deviceLabel,
      });

      if (claimRes.error) {
        return bad("Device session claim failed: " + claimRes.error.message, 500);
      }

      claim = claimRes.data as any;

      if (!claim?.ok) {
        return bad(String(claim?.error || "Device session claim failed."), 403);
      }
    }

    const verified = await computeVerified(rpcSupabase, user);

    if (deviceId) {
      const promoEnsureRes = await rpcSupabase.rpc("jride_promo_ensure_android_credit", {
        p_user_id: user.id,
        p_device_id: deviceId,
        p_program_code: "ANDROID_FIRST_RIDE_40",
      });

      promoEnsure = !promoEnsureRes.error ? (promoEnsureRes.data as any) : null;
    }

    const meta = (user.user_metadata ?? {}) as any;
    const fullName =
      meta.full_name ??
      meta.name ??
      meta.display_name ??
      null;

    return NextResponse.json(
      {
        ok: true,
        user_id: user.id,
        phone: phone || (user as any).phone || null,
        email: user.email ?? email,
        email_used: email,
        full_name: fullName,
        name: fullName,
        access_token: accessToken,
        device_id: deviceId,
        device_session: deviceId
          ? {
              action: claim?.action ?? null,
              session_id: claim?.session_id ?? null,
              auth_version: claim?.auth_version ?? null,
            }
          : null,
        verified,
        promo: deviceId && promoEnsure && promoEnsure.ok ? promoEnsure : null,
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Login failed." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}