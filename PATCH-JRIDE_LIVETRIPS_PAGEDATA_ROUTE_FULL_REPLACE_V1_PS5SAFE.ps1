# PATCH-JRIDE_LIVETRIPS_PAGEDATA_ROUTE_FULL_REPLACE_V1_PS5SAFE.ps1
param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }

if (-not (Test-Path -LiteralPath $WebRoot)) {
  Fail "WebRoot not found: $WebRoot"
}

$target = Join-Path $WebRoot "app\api\admin\livetrips\page-data\route.ts"
if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$backupDir = Join-Path $WebRoot "app\api\admin\livetrips\page-data\_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("route.ts.bak.PAGEDATA_FULL_REPLACE_V1." + $stamp)
Copy-Item -LiteralPath $target -Destination $backup -Force
Ok "Backup: $backup"

$newContent = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Json = Record<string, any>;

type ZoneRow = {
  zone_id: string;
  zone_name: string;
  color_hex?: string | null;
  capacity_limit?: number | null;
  active_drivers?: number | null;
  available_slots?: number | null;
  status?: string | null;
};

function normalizeKeys(row: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(row || {})) {
    out[String(k)] = v;
  }
  return out;
}

function normalizeTrip(row: Json): Json {
  const r = normalizeKeys(row);
  return {
    ...r,
    booking_code: r.booking_code ?? r.bookingCode ?? null,
    pickup_label: r.pickup_label ?? r.from_label ?? r.fromLabel ?? null,
    dropoff_label: r.dropoff_label ?? r.to_label ?? r.toLabel ?? null,
    zone: r.zone ?? r.town ?? r.zone_name ?? null,
    status: r.status ?? "pending",
  };
}

async function loadBookings(supabase: ReturnType<typeof supabaseAdmin>) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(300);

  if (error) {
    console.error("PAGE_DATA_BOOKINGS_ERROR", error);
    return {
      trips: [] as Json[],
      usedColumns: [] as string[],
      warnings: ["BOOKINGS_SELECT_FAILED:" + error.message],
    };
  }

  const rows = Array.isArray(data) ? data : [];
  const usedColumns = rows.length ? Object.keys(normalizeKeys(rows[0])) : ([] as string[]);

  return {
    trips: rows.map((row: any) => normalizeTrip(row)),
    usedColumns,
    warnings: [] as string[],
  };
}

async function tryLoadZones(supabase: ReturnType<typeof supabaseAdmin>) {
  const warnings: string[] = [];

  for (const table of ["zones", "dispatch_zones", "service_zones"]) {
    const { data, error } = await supabase.from(table).select("*").limit(200);

    if (error) {
      warnings.push(table.toUpperCase() + "_QUERY_FAILED:" + error.message);
      continue;
    }

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      continue;
    }

    const zones: ZoneRow[] = rows.map((z: any) => {
      const r = normalizeKeys(z);
      return {
        zone_id: String(r.zone_id ?? r.id ?? r.name ?? r.zone_name ?? ""),
        zone_name: String(r.zone_name ?? r.name ?? r.zone_id ?? r.id ?? "Unknown"),
        color_hex: r.color_hex ?? null,
        capacity_limit: r.capacity_limit ?? null,
        active_drivers: r.active_drivers ?? null,
        available_slots: r.available_slots ?? null,
        status: r.status ?? null,
      };
    });

    return { zones, zoneSource: table, warnings };
  }

  return { zones: [] as ZoneRow[], zoneSource: null as string | null, warnings };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    const supabase = supabaseAdmin();

    const [bookingsRes, zonesRes] = await Promise.all([
      loadBookings(supabase),
      tryLoadZones(supabase),
    ]);

    const warnings = [...bookingsRes.warnings, ...zonesRes.warnings];

    const payload: Json = {
      ok: true,
      zones: zonesRes.zones,
      trips: bookingsRes.trips,
      bookings: bookingsRes.trips,
      data: bookingsRes.trips,
      warnings,
    };

    if (debug) {
      payload.debug = {
        bookingColumnsUsed: bookingsRes.usedColumns,
        zoneSource: zonesRes.zoneSource,
        tripCount: bookingsRes.trips.length,
        zoneCount: zonesRes.zones.length,
        note: "bookings and zones are loaded via select(*) in this build",
      };
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    console.error("PAGE_DATA_UNEXPECTED", err);
    return NextResponse.json(
      {
        ok: false,
        error: "PAGE_DATA_UNEXPECTED",
        message: err?.message ?? "Unexpected error",
        zones: [],
        trips: [],
        bookings: [],
        data: [],
      },
      { status: 500 }
    );
  }
}
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $newContent, $utf8NoBom)
Ok "Replaced: $target"

$verify = Get-Content -LiteralPath $target -Raw

$markers = @(
  'function normalizeKeys(row: Json): Json',
  '.from("bookings")',
  '.select("*")',
  'async function tryLoadZones',
  'BOOKINGS_SELECT_FAILED'
)

$missing = @()
foreach ($m in $markers) {
  if ($verify.IndexOf($m) -lt 0) { $missing += $m }
}

if ($verify.IndexOf("getExistingColumns") -ge 0) {
  $missing += "getExistingColumns still present"
}
if ($verify.IndexOf("'disabled_schema_check'") -ge 0) {
  $missing += "'disabled_schema_check' still present"
}
if ($verify.IndexOf("BOOKINGS_SCHEMA_NOT_READABLE") -ge 0) {
  $missing += "BOOKINGS_SCHEMA_NOT_READABLE still present"
}

if ($missing.Count -gt 0) {
  Fail ("Verification failed. Missing or invalid markers: " + ($missing -join ", "))
}

Ok "Verification passed."
Info "Now run: npm run build"