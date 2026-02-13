# PATCH-DISPATCH-LGU-BACKEND-ENRICH.ps1
# Full file replace: app/api/dispatch/bookings/route.ts
# Adds LGU-required fields to bookings payload:
# - pickup_label (from_label)
# - dropoff_label (to_label)
# - fare (verified_fare fallback chain)
# - distance_km (parsed from passenger_fare_response if available)
# No DB changes.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }
function WriteUtf8NoBom([string]$path, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllBytes($path, $enc.GetBytes($text))
}

$ts = Stamp
$target = "app\api\dispatch\bookings\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

Copy-Item $target "$target.bak.$ts" -Force
Write-Host "[OK] Backup: $target.bak.$ts" -ForegroundColor Green

$content = @'
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
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
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

function asNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function safeJsonParse(v: any): any {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") return JSON.parse(v);
    return null;
  } catch {
    return null;
  }
}

function pickFirstNumber(obj: any, keys: string[]): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const val = (obj as any)[k];
    if (val === null || val === undefined) continue;
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractDistanceKm(row: any): number | null {
  // Distance is not a dedicated column in your schema.
  // We extract it from passenger_fare_response if present.
  const p = safeJsonParse(row?.passenger_fare_response);
  if (!p) return null;

  // common variants we might find
  let n =
    pickFirstNumber(p, ["distance_km", "distanceKm", "km", "distance"]) ??
    pickFirstNumber(p?.data, ["distance_km", "distanceKm", "km", "distance"]) ??
    null;

  if (n == null) return null;

  // Heuristic: if distance looks like meters (e.g. > 1000), convert to km
  if (n > 1000) n = n / 1000;

  // Guard against nonsense
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100; // 2 decimals
}

function computeFare(row: any): number | null {
  // Prefer verified_fare (LGU-friendly), then proposed_fare,
  // then fallback to total_errand_fare or sum of components if present.
  const verified = asNum(row?.verified_fare);
  if (verified != null) return verified;

  const proposed = asNum(row?.proposed_fare);
  if (proposed != null) return proposed;

  const totalErrand = asNum(row?.total_errand_fare);
  if (totalErrand != null) return totalErrand;

  const base = asNum(row?.base_fee) || 0;
  const distFare = asNum(row?.distance_fare) || 0;
  const wait = asNum(row?.waiting_fee) || 0;
  const extraStop = asNum(row?.extra_stop_fee) || 0;

  const sum = base + distFare + wait + extraStop;
  if (sum > 0) return Math.round(sum * 100) / 100;

  return null;
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

    // LGU enrichment: include labels + fare sources + passenger_fare_response
    const { data, error } = await sb
      .from("bookings")
      .select(
        [
          "id",
          "booking_code",
          "town",
          "status",
          "driver_id",
          "trip_type",
          "vendor_id",
          "takeout_service_level",
          "pickup_lat",
          "pickup_lng",
          "dropoff_lat",
          "dropoff_lng",
          "from_label",
          "to_label",
          "created_at",
          "verified_fare",
          "proposed_fare",
          "total_errand_fare",
          "base_fee",
          "distance_fare",
          "waiting_fee",
          "extra_stop_fee",
          "passenger_fare_response",
        ].join(",")
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return jsonError(error.message, 500);

    const rows = (data || []).map((r: any) => {
      const pickup_label = r.from_label ?? null;
      const dropoff_label = r.to_label ?? null;
      const distance_km = extractDistanceKm(r);
      const fare = computeFare(r);

      // Keep original fields + add derived report fields
      return {
        ...r,
        pickup_label,
        dropoff_label,
        distance_km,
        fare,
      };
    });

    return NextResponse.json({ ok: true, rows });
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

    const tripType = String(body.service_type || body.trip_type || "dispatch")
      .trim()
      .toLowerCase();
    const town =
      body.town != null && String(body.town).trim() !== ""
        ? String(body.town).trim()
        : null;

    const vendorIdRaw = body.vendor_id != null ? String(body.vendor_id).trim() : "";
    const vendor_id = vendorIdRaw !== "" ? vendorIdRaw : null;

    // Pickup coords (for dispatch nearest-driver)
    const pickup_lat = asNum(body.pickup_lat);
    const pickup_lng = asNum(body.pickup_lng);

    // For takeout, set service level (default regular)
    const takeout_service_level =
      tripType === "takeout"
        ? String(body.takeout_service_level || "regular").trim().toLowerCase()
        : null;

    const booking_code =
      tripType === "takeout" ? genCode("TAKEOUT-UI-") : genCode("JR-UI-DISPATCH-");

    const insert: any = {
      booking_code,
      status: "new",
      town,
      trip_type: tripType,
      vendor_id,
    };

    if (tripType === "takeout") {
      insert.takeout_service_level =
        takeout_service_level === "express" ? "express" : "regular";
    } else {
      // Dispatch: store pickup coords if provided
      insert.pickup_lat = pickup_lat;
      insert.pickup_lng = pickup_lng;
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("bookings")
      .insert(insert)
      .select(
        "id,booking_code,status,town,driver_id,trip_type,vendor_id,takeout_service_level,pickup_lat,pickup_lng,created_at,updated_at"
      )
      .single();

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
'@

WriteUtf8NoBom $target $content
Write-Host "[DONE] Patched: $target" -ForegroundColor Green
Write-Host "Next: npm.cmd run build ; npm.cmd run dev" -ForegroundColor Yellow
