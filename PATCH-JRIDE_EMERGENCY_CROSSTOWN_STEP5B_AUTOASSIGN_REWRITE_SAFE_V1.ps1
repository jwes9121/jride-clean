# PATCH-JRIDE_EMERGENCY_CROSSTOWN_STEP5B_AUTOASSIGN_REWRITE_SAFE_V1.ps1
# Rewrites app\api\dispatch\auto-assign\route.ts to a clean STEP 5B implementation.
# - is_emergency from body OR booking row
# - same-town only unless emergency (fallback safe)
# - no pricing, no mapbox

$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$path = Join-Path $root "app\api\dispatch\auto-assign\route.ts"

Backup-File $path

$new = @'
import { NextResponse } from "next/server";
import supabase from "@/lib/supabaseClient";

// Haversine distance in km between two lat/lng pairs
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function str(x: any) {
  return String(x ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const body: any = await req.json().catch(() => ({}));

    const bookingId = str(body.bookingId);
    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);

    if (!bookingId || Number.isNaN(pickupLat) || Number.isNaN(pickupLng)) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    // ===== STEP 5B: Emergency cross-town mode =====
    // can come from UI payload (STEP 5A) or booking row
    let isEmergency =
      body?.is_emergency === true ||
      body?.isEmergency === true;

    let bookingTown = "";

    try {
      const { data: bk, error: bkErr } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .maybeSingle();

      if (!bkErr && bk) {
        // @ts-ignore
        if (!isEmergency && (bk as any)?.is_emergency === true) isEmergency = true;

        // Try common town field names WITHOUT assuming any exist
        const candidatesTown: any[] = [
          // @ts-ignore
          (bk as any)?.pickup_town,
          // @ts-ignore
          (bk as any)?.town,
          // @ts-ignore
          (bk as any)?.passenger_town,
          // @ts-ignore
          (bk as any)?.pickupTown,
          // @ts-ignore
          (bk as any)?.pickup_town_name,
        ];

        for (const t of candidatesTown) {
          const s = str(t);
          if (s) { bookingTown = s; break; }
        }
      }
    } catch {
      // keep safe fallback behavior
    }
    // ===== END STEP 5B =====

    // 1) Load driver locations
    const { data: driverRows, error: locError } = await supabase
      .from("driver_locations")
      .select("driver_id, lat, lng, status, updated_at, town");

    if (locError) {
      console.error("driver_locations error", locError);
      throw locError;
    }

    if (!driverRows || driverRows.length === 0) {
      return NextResponse.json({ error: "NO_DRIVERS" }, { status: 400 });
    }

    // 2) Candidates: any driver with coordinates, not explicitly on_trip
    const candidates = (driverRows as any[]).filter((row: any) => {
      if (row?.lat == null || row?.lng == null) return false;

      const statusText = str(row?.status).toLowerCase();
      if (statusText === "on_trip") return false;

      return true;
    });

    if (candidates.length === 0) {
      return NextResponse.json({ error: "NO_AVAILABLE_DRIVER" }, { status: 400 });
    }

    // 2.5) STEP 5B Town gate (normal mode only)
    let filteredCandidates = candidates;

    if (!isEmergency && bookingTown) {
      const bt = bookingTown.toLowerCase();
      const sameTown = candidates.filter((d: any) => str(d?.town).toLowerCase() === bt);

      // If same-town yields none, fallback to old behavior to avoid regressions
      filteredCandidates = sameTown.length > 0 ? sameTown : candidates;
    }

    // 3) Find nearest by haversine distance
    let best: any = null;
    let bestDistance = Infinity;

    for (const d of filteredCandidates) {
      const distKm = haversine(
        pickupLat,
        pickupLng,
        Number(d.lat),
        Number(d.lng)
      );

      if (distKm < bestDistance) {
        bestDistance = distKm;
        best = d;
      }
    }

    if (!best) {
      return NextResponse.json({ error: "NO_DRIVER_FOUND" }, { status: 400 });
    }

    // 4) Update booking with assigned driver
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        assigned_driver_id: best.driver_id,
        status: "assigned",
      })
      .eq("id", bookingId);

    if (updateError) {
      console.error("update booking error", updateError);
      throw updateError;
    }

    return NextResponse.json({
      ok: true,
      assignedDriverId: best.driver_id,
      distanceKm: bestDistance,
      is_emergency: isEmergency,
      bookingTown: bookingTown || null,
      candidates_total: candidates.length,
      candidates_used: filteredCandidates.length,
    });
  } catch (err: any) {
    console.error("auto-assign error", err);
    return NextResponse.json(
      { error: err?.message ?? "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $new, $utf8NoBom)

Write-Host "[DONE] Rewrote: $path"
Write-Host ""
Write-Host "NEXT: npm run build"
