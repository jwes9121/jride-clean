# PATCH-ALLOW-PROD-DISPATCH-BOOKINGS-GET.ps1
# Full file replace: app/api/dispatch/bookings/route.ts
# Fix: allow GET /api/dispatch/bookings in production (read-only) so Dispatch works.
# Keep POST protected (admin/dispatcher).

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
import { auth } from "@/auth";

function jsonError(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
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
  const p = safeJsonParse(row?.passenger_fare_response);
  if (!p) return null;

  let n =
    pickFirstNumber(p, ["distance_km", "distanceKm", "km", "distance"]) ??
    pickFirstNumber(p?.data, ["distance_km", "distanceKm", "km", "distance"]) ??
    null;

  if (n == null) return null;

  if (n > 1000) n = n / 1000;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function computeFare(row: any): number | null {
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
    // ✅ Production fix:
    // GET is READ-ONLY and must be accessible for the dispatch console.
    // (Status log is already accessible; keeping this consistent.)
    // If you later want to lock it down, we can add a header token gate.

    const sb = supabaseAdmin();

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
    // ✅ Keep POST protected in production
    const session = await auth();
    const role = (session?.user as any)?.role;
    if (!isAllowedRole(role)) return jsonError("Forbidden", 403);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON", 400);

    const tripType = String(body.service_type || body.trip_type || "dispatch")
      .trim()
      .toLowerCase();

    const town =
      body.town != null && String(body.town).trim() !== ""
        ? String(body.town).trim()
        : null;

    const vendorIdRaw =
      body.vendor_id != null ? String(body.vendor_id).trim() : "";
    const vendor_id = vendorIdRaw !== "" ? vendorIdRaw : null;

    const pickup_lat = asNum(body.pickup_lat);
    const pickup_lng = asNum(body.pickup_lng);

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

    return NextResponse.json({ ok: true, row: data });
  } catch (e: any) {
    return jsonError(String(e?.message || e), 500);
  }
}
'@

WriteUtf8NoBom $target $content
Write-Host "[DONE] Patched: $target" -ForegroundColor Green
Write-Host "Next: npm.cmd run build ; git commit/tag/push ; redeploy on Vercel" -ForegroundColor Yellow
