param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function New-Timestamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }
function Ensure-Dir([string]$p) { if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }
function Write-NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$ts = New-Timestamp

$target = Join-Path $proj "app\api\driver\active-trip\route.ts"
if (-not (Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

$bakDir = Join-Path $proj "_patch_bak"
Ensure-Dir $bakDir
$bak = Join-Path $bakDir ("route.ts.bak.DRIVER_ACTIVE_TRIP_SERVICE_ROLE_V1.$ts")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$new = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}

function parseDateMs(v: any): number | null {
  try {
    const t = Date.parse(String(v || ""));
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function allow(req: Request) {
  // Recommended: protect with DRIVER_PING_SECRET (already in your Vercel env)
  const want = String(process.env.DRIVER_PING_SECRET || "").trim();
  const got = String(req.headers.get("x-driver-ping-secret") || "").trim();
  if (!want) return true; // if not set, allow (dev)
  return Boolean(got) && got === want;
}

export async function GET(req: Request) {
  try {
    if (!allow(req)) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const u = new URL(req.url);
    const driverId = String(u.searchParams.get("driver_id") || "").trim();

    if (!driverId || !isUuidLike(driverId)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_DRIVER_ID", message: "driver_id is required (uuid)." },
        { status: 400 }
      );
    }

    const supabase = getAdminClient();

    const activeStatuses = ["assigned","accepted","fare_proposed","on_the_way","arrived","on_trip","ready"];

    function hasFareEvidence(r: any): boolean {
      const pf = (r as any)?.proposed_fare;
      const vf = (r as any)?.verified_fare;
      const pr = (r as any)?.passenger_fare_response;
      return pf != null || vf != null || pr != null;
    }
    function isMovementState(st: string): boolean {
      return st === "on_the_way" || st === "arrived" || st === "on_trip";
    }
    function isReadyButNotAccepted(r: any): boolean {
      const st = String((r as any)?.status ?? "");
      if (st !== "ready") return false;
      const pr = String((r as any)?.passenger_fare_response ?? "").toLowerCase();
      return pr !== "accepted";
    }

    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .or(`assigned_driver_id.eq.${driverId},driver_id.eq.${driverId}`)
      .in("status", activeStatuses)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      return NextResponse.json({ ok: false, error: "DB_ERROR", message: error.message }, { status: 500 });
    }

    const rows: any[] = Array.isArray(data) ? (data as any[]) : [];

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        driver_id: driverId,
        trip: null,
        note: "NO_ACTIVE_TRIP",
        active_statuses: activeStatuses,
      });
    }

    const now = Date.now();
    const ASSIGNED_MAX_AGE_MINUTES = 90;
    const assignedMaxAgeMs = ASSIGNED_MAX_AGE_MINUTES * 60 * 1000;

    let picked: any = null;

    // 1) Prefer non-assigned states first
    for (const r of rows) {
      const st = String((r as any)?.status ?? "");
      if (!st || st === "assigned") continue;
      if (isMovementState(st) && !hasFareEvidence(r)) continue;
      if (isReadyButNotAccepted(r)) continue;
      picked = r;
      break;
    }

    // 2) Else allow recent assigned
    if (!picked) {
      for (const r of rows) {
        const st = String((r as any)?.status ?? "");
        if (st !== "assigned") continue;
        const t = parseDateMs((r as any)?.updated_at) ?? parseDateMs((r as any)?.created_at);
        if (t && (now - t) <= assignedMaxAgeMs) {
          picked = r;
          break;
        }
      }
    }

    const trip = picked || null;

    return NextResponse.json({
      ok: true,
      driver_id: driverId,
      trip,
      note: trip ? "ACTIVE_TRIP_FOUND" : "NO_ACTIVE_TRIP",
      active_statuses: activeStatuses,
      assigned_max_age_minutes: ASSIGNED_MAX_AGE_MINUTES,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
'@

Write-NoBom $target $new
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] npm.cmd run build"