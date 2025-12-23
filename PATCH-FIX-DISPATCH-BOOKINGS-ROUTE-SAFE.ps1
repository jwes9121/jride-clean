# PATCH-FIX-DISPATCH-BOOKINGS-ROUTE-SAFE.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\dispatch\bookings\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $target "$target.bak.$ts" -Force
Write-Host "[OK] Backup: $target.bak.$ts" -ForegroundColor Green

# Write a known-good, minimal route that won't assume columns exist
@'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// NOTE: In this dev workflow we keep auth simple.
// - If you're on localhost and NODE_ENV != production, we allow bypass
// - Otherwise require admin/dispatcher role from NextAuth session
import { auth } from "@/auth";

function jsonError(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function jrideDevBypass(req: NextRequest): boolean {
  try {
    if (process.env.NODE_ENV === "production") return false;

    const host = String(req.headers.get("host") || "");
    const isLocal =
      host.includes("localhost") ||
      host.includes("127.0.0.1") ||
      host.includes("0.0.0.0");

    if (!isLocal) return false;

    // Optional: set header x-jride-dev-bypass: 1 to force on/off.
    // Default: enabled for localhost dev.
    const h = String(req.headers.get("x-jride-dev-bypass") || "");
    if (h === "0") return false;
    return true;
  } catch {
    return false;
  }
}

function isAllowedRole(role: any): boolean {
  return role === "admin" || role === "dispatcher";
}

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function genCode(prefix: string) {
  // e.g. TAKEOUT-UI-20251223-235959
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const code =
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  return `${prefix}${code}`;
}

export async function GET(req: NextRequest) {
  try {
    const bypass = jrideDevBypass(req);

    if (!bypass) {
      const session = await auth();
      const role = (session?.user as any)?.role;
      if (!isAllowedRole(role)) return jsonError("Forbidden", 403);
    }

    const sb = supabaseAdmin();

    // Select only fields we *know* we use in UI and are safe.
    const { data, error } = await sb
      .from("bookings")
      .select("id, booking_code, town, status, driver_id, trip_type, vendor_id, takeout_service_level, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (e: any) {
    return jsonError(String(e?.message || e), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const bypass = jrideDevBypass(req);

    let dispatcherEmail: string | null = null;

    if (!bypass) {
      const session = await auth();
      const role = (session?.user as any)?.role;
      if (!isAllowedRole(role)) return jsonError("Forbidden", 403);
      dispatcherEmail = session?.user?.email ? String(session.user.email) : null;
    }

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON", 400);

    // Inputs from your Dispatch UI:
    // body.service_type: "takeout" (for this feature)
    // body.takeout_service_level: "regular" | "express"
    // body.vendor_id: UUID string
    // body.town: optional string
    const tripType = String(body.service_type || body.trip_type || "dispatch").trim().toLowerCase();
    const town = body.town != null && String(body.town).trim() !== "" ? String(body.town).trim() : null;

    const vendorIdRaw = body.vendor_id != null ? String(body.vendor_id).trim() : "";
    const vendor_id = vendorIdRaw !== "" ? vendorIdRaw : null;

    // For takeout, set service level (default regular)
    const takeout_service_level =
      tripType === "takeout"
        ? String(body.takeout_service_level || "regular").trim().toLowerCase()
        : null;

    // Generate a booking code that lets LiveTrips detect it
    const booking_code =
      tripType === "takeout"
        ? genCode("TAKEOUT-UI-")
        : genCode("JR-UI-DISPATCH-");

    const insert: any = {
      booking_code,
      status: "new",
      town,
      trip_type: tripType,
      vendor_id,
    };

    if (tripType === "takeout") {
      insert.takeout_service_level = (takeout_service_level === "express") ? "express" : "regular";
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb.from("bookings").insert(insert).select("*").single();
    if (error) return jsonError(error.message, 500);

    // Best-effort log (DON'T fail create if table/cols differ)
    try {
      await sb.from("dispatch_action_logs").insert({
        booking_id: data.id,
        action: "created",
        actor_email: dispatcherEmail,
        details: insert,
      } as any);
    } catch {}

    return NextResponse.json({ ok: true, row: data });
  } catch (e: any) {
    return jsonError(String(e?.message || e), 500);
  }
}
'@ | Set-Content -Path $target -Encoding UTF8

Write-Host "[OK] Replaced dispatch bookings route with safe minimal version." -ForegroundColor Green
Write-Host "Next: restart dev server (CTRL+C then npm run dev) if it doesn't auto-reload." -ForegroundColor Yellow
