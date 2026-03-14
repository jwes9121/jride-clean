param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE LIVETRIPS PAGE-DATA DIRECT BOOKINGS V1 (PS5-safe) =="

$routePath = Join-Path $ProjRoot "app\api\admin\livetrips\page-data\route.ts"
if (!(Test-Path $routePath)) {
  throw "route.ts not found: $routePath"
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item $routePath (Join-Path $backupDir ("route.ts.bak.LIVETRIPS_PAGE_DATA_DIRECT_BOOKINGS_V1.{0}" -f $timestamp)) -Force
Write-Host "[OK] Backup created"

$content = @'
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

function normalizeTrip(row: Json): Json {
  return {
    ...row,
    booking_code: row.booking_code ?? row.bookingCode ?? null,
    pickup_label: row.pickup_label ?? row.from_label ?? row.fromLabel ?? null,
    dropoff_label: row.dropoff_label ?? row.to_label ?? row.toLabel ?? null,
    zone: row.zone ?? row.town ?? row.zone_name ?? null,
    status: row.status ?? "requested",
  };
}

async function loadBookings(supabase: ReturnType<typeof supabaseAdmin>) {
  // Use direct bookings query only.
  // These columns are already evidenced in your stack / DB checks and are enough for LiveTrips.
  const query = [
    "id",
    "booking_code",
    "pickup_lat",
    "pickup_lng",
    "status",
    "driver_id",
    "assigned_driver_id",
    "created_at",
    "updated_at",
    "town"
  ].join(",");

  const { data, error } = await supabase
    .from("bookings")
    .select(query)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(300);

  if (error) {
    console.error("PAGE_DATA_BOOKINGS_QUERY_ERROR", { message: error.message, query });
    return {
      trips: [] as Json[],
      warnings: ["BOOKINGS_QUERY_FAILED", error.message],
    };
  }

  return {
    trips: (data || []).map(normalizeTrip),
    warnings: [] as string[],
  };
}

async function tryLoadZones(supabase: ReturnType<typeof supabaseAdmin>) {
  // Disable schema-cache probing via information_schema.columns.
  // Return empty zones safely instead of breaking the page-data response.
  return {
    zones: [] as ZoneRow[],
    zoneSource: null as string | null,
    warnings: ["ZONES_SCHEMA_PROBE_DISABLED"],
  };
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
        tripCount: bookingsRes.trips.length,
        zoneCount: zonesRes.zones.length,
        note: "Direct bookings query; information_schema probing disabled",
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

Set-Content -LiteralPath $routePath -Value $content -Encoding UTF8
Write-Host "[OK] Wrote route.ts"
Write-Host ""
Write-Host "PATCH COMPLETE"
Write-Host "Modified file:"
Write-Host " - $routePath"