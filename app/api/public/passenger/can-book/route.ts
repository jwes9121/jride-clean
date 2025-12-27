import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bad(msg: string, status = 400, code?: string) {
  return NextResponse.json({ ok: false, error: msg, code: code || "BAD_REQUEST" }, { status });
}

function nowInManilaParts() {
  // Force Philippine time regardless of server timezone
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const hh = parseInt(get("hour") || "0", 10);
  const mm = parseInt(get("minute") || "0", 10);
  const ss = parseInt(get("second") || "0", 10);
  return { hh, mm, ss, isoLike: dtf.format(new Date()) };
}

function isNightPH(): boolean {
  // Night window: 20:00 -> 05:00 (PH time)
  const { hh } = nowInManilaParts();
  return (hh >= 20) || (hh < 5);
}

function truthy(v: any): boolean {
  if (v === true) return true;
  if (typeof v === "string") return ["1","true","yes","y","on"].includes(v.trim().toLowerCase());
  if (typeof v === "number") return v === 1;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const user_id = String(body?.user_id ?? "").trim();
    if (!user_id) return bad("user_id is required.", 400, "MISSING_USER_ID");

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
      return bad("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on server.", 500, "MISSING_SUPABASE_ENV");
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.auth.admin.getUserById(user_id);
    if (error) return bad(error.message || "Failed to fetch user.", 500, "USER_LOOKUP_FAILED");

    const md: any = data?.user?.user_metadata || {};
    const role = String(md?.role ?? "").trim() || "passenger";

    // Only enforce this rule for passengers
    if (role !== "passenger") {
      return NextResponse.json({
        ok: true,
        allowed: true,
        reason: "NON_PASSENGER_ROLE",
        isNightPH: isNightPH(),
      });
    }

    const verified = truthy(md?.verified);
    const night_allowed = truthy(md?.night_allowed) || verified;

    const night = isNightPH();
    if (night && !night_allowed) {
      return NextResponse.json({
        ok: false,
        allowed: false,
        code: "NIGHT_VERIFICATION_REQUIRED",
        error: "Night booking (8PM-5AM) requires a verified passenger.",
        isNightPH: true,
      }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      allowed: true,
      verified,
      night_allowed,
      isNightPH: night,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error." }, { status: 500 });
  }
}
