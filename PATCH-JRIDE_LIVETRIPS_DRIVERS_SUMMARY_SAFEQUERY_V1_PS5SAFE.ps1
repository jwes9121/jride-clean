param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE Patch: drivers-summary safe query (V1 / PS5-safe) =="
Write-Host "Root: $ProjRoot"

function Write-TextUtf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and !(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  if (!(Test-Path -LiteralPath $Path)) {
    Write-Host "[WARN] Missing file for backup: $Path"
    return
  }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($Path)
  $bak = Join-Path $bakDir ($name + ".bak." + $Tag + "." + $stamp)
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$routePath = Join-Path $ProjRoot "app\api\admin\livetrips\drivers-summary\route.ts"
Backup-File -Path $routePath -Tag "DRIVERS_SUMMARY_SAFEQUERY_V1"

$routeContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function s(v: any): string {
  return String(v ?? "");
}

function formatPH(input?: string | null) {
  if (!input) return null;
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) return input;
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function ageSeconds(input?: string | null) {
  if (!input) return null;
  const ms = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 1000));
}

export async function GET() {
  try {
    const sbUrl =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";

    const sbServiceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "";

    if (!sbUrl || !sbServiceKey) {
      return bad("Missing service-role env", "MISSING_SERVICE_ROLE_ENV", 500, {
        has_SUPABASE_URL: Boolean(sbUrl),
        has_SUPABASE_SERVICE_ROLE_KEY: Boolean(sbServiceKey),
      });
    }

    const supabase = createClient(sbUrl, sbServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const staleAfterSeconds = 120;
    const assignCutoffMinutes = Number(process.env.JRIDE_DRIVER_FRESH_MINUTES || "10");
    const assignCutoffSeconds = assignCutoffMinutes * 60;
    const onlineLike = new Set(["online", "available", "idle", "waiting"]);
    const activeStatuses = new Set(["assigned", "accepted", "fare_proposed", "on_the_way", "arrived", "enroute", "on_trip"]);

    const locRes = await supabase
      .from("driver_locations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1000);

    if (locRes.error) {
      return bad("driver_locations query failed", "DRIVER_LOCATIONS_QUERY_FAILED", 500, {
        details: locRes.error.message,
      });
    }

    const latestByDriver = new Map<string, any>();
    for (const row of (locRes.data || []) as any[]) {
      const did = s(row?.driver_id).trim();
      if (!did) continue;
      if (!latestByDriver.has(did)) latestByDriver.set(did, row);
    }

    const ids = Array.from(latestByDriver.keys());
    if (!ids.length) {
      return ok({
        ok: true,
        count: 0,
        stale_after_seconds: staleAfterSeconds,
        assign_cutoff_minutes: assignCutoffMinutes,
        drivers: [],
      });
    }

    const profRes = await supabase
      .from("driver_profiles")
      .select("driver_id, full_name, municipality")
      .in("driver_id", ids);

    if (profRes.error) {
      return bad("driver_profiles query failed", "DRIVER_PROFILES_QUERY_FAILED", 500, {
        details: profRes.error.message,
      });
    }

    const profileByDriver = new Map<string, any>();
    for (const row of (profRes.data || []) as any[]) {
      const did = s(row?.driver_id).trim();
      if (did) profileByDriver.set(did, row);
    }

    const bookingsByDriverRes = await supabase
      .from("bookings")
      .select("id, booking_code, driver_id, assigned_driver_id, status, town, created_at, updated_at")
      .in("driver_id", ids)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (bookingsByDriverRes.error) {
      return bad("bookings(driver_id) query failed", "BOOKINGS_BY_DRIVER_QUERY_FAILED", 500, {
        details: bookingsByDriverRes.error.message,
      });
    }

    const bookingsByAssignedRes = await supabase
      .from("bookings")
      .select("id, booking_code, driver_id, assigned_driver_id, status, town, created_at, updated_at")
      .in("assigned_driver_id", ids)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (bookingsByAssignedRes.error) {
      return bad("bookings(assigned_driver_id) query failed", "BOOKINGS_BY_ASSIGNED_QUERY_FAILED", 500, {
        details: bookingsByAssignedRes.error.message,
      });
    }

    const bookingMap = new Map<string, any>();
    for (const row of ([] as any[]).concat(bookingsByDriverRes.data || [], bookingsByAssignedRes.data || [])) {
      const bid = s(row?.id).trim();
      if (!bid) continue;
      if (!bookingMap.has(bid)) bookingMap.set(bid, row);
    }

    const countsByDriver = new Map<string, {
      completed: number;
      cancelled: number;
      activeBooking: any | null;
    }>();

    function touchDriver(did: string) {
      if (!countsByDriver.has(did)) {
        countsByDriver.set(did, {
          completed: 0,
          cancelled: 0,
          activeBooking: null,
        });
      }
      return countsByDriver.get(did)!;
    }

    for (const row of bookingMap.values()) {
      const st = s(row?.status).trim().toLowerCase();
      const did1 = s(row?.driver_id).trim();
      const did2 = s(row?.assigned_driver_id).trim();

      const related = Array.from(new Set([did1, did2].filter(Boolean)));
      for (const did of related) {
        const entry = touchDriver(did);

        if (st === "completed") entry.completed += 1;
        if (st === "cancelled") entry.cancelled += 1;

        if (activeStatuses.has(st)) {
          const currentTs = new Date(s(entry.activeBooking?.updated_at || entry.activeBooking?.created_at || 0)).getTime();
          const rowTs = new Date(s(row?.updated_at || row?.created_at || 0)).getTime();
          if (!entry.activeBooking || rowTs > currentTs) {
            entry.activeBooking = row;
          }
        }
      }
    }

    const drivers = ids.map((did) => {
      const loc = latestByDriver.get(did) || {};
      const prof = profileByDriver.get(did) || {};
      const counts = countsByDriver.get(did) || { completed: 0, cancelled: 0, activeBooking: null };

      const updatedAt = loc?.updated_at ?? null;
      const age = ageSeconds(updatedAt);
      const rawStatus = s(loc?.status).trim().toLowerCase();
      const isStale = age == null ? true : age > staleAfterSeconds;
      const effectiveStatus = isStale ? "stale" : rawStatus;
      const assignFresh = age == null ? false : age <= assignCutoffSeconds;
      const assignOnlineEligible = onlineLike.has(rawStatus);
      const assignEligible = assignFresh && assignOnlineEligible;

      return {
        id: loc?.id ?? null,
        driver_id: did,
        full_name: prof?.full_name ?? null,
        municipality: prof?.municipality ?? null,
        town: loc?.town ?? null,
        home_town: loc?.home_town ?? prof?.municipality ?? null,
        zone: loc?.town ?? loc?.home_town ?? prof?.municipality ?? null,
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
        status: loc?.status ?? null,
        effective_status: effectiveStatus,
        updated_at: updatedAt,
        updated_at_ph: formatPH(updatedAt),
        created_at: loc?.created_at ?? null,
        created_at_ph: formatPH(loc?.created_at ?? null),
        age_seconds: age,
        is_stale: isStale,
        assign_cutoff_minutes: assignCutoffMinutes,
        assign_fresh: assignFresh,
        assign_online_eligible: assignOnlineEligible,
        assign_eligible: assignEligible,
        vehicle_type: loc?.vehicle_type ?? null,
        capacity: loc?.capacity ?? null,
        completed_trips_count: counts.completed,
        cancelled_trips_count: counts.cancelled,
        active_booking_id: counts.activeBooking?.id ?? null,
        active_booking_code: counts.activeBooking?.booking_code ?? null,
        active_booking_status: counts.activeBooking?.status ?? null,
        active_booking_town: counts.activeBooking?.town ?? null,
        active_booking_updated_at: counts.activeBooking?.updated_at ?? counts.activeBooking?.created_at ?? null,
      };
    });

    return ok({
      ok: true,
      count: drivers.length,
      stale_after_seconds: staleAfterSeconds,
      assign_cutoff_minutes: assignCutoffMinutes,
      drivers,
    });
  } catch (e: any) {
    return bad("Unexpected drivers-summary error", "DRIVERS_SUMMARY_UNEXPECTED", 500, {
      details: String(e?.message || e),
    });
  }
}
'@

Write-TextUtf8NoBom -Path $routePath -Content $routeContent
Write-Host "[OK] Wrote: app/api/admin/livetrips/drivers-summary/route.ts"
Write-Host "[DONE] Patch applied."