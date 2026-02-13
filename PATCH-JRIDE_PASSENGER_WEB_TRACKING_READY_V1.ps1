# PATCH-JRIDE_PASSENGER_WEB_TRACKING_READY_V1.ps1
# - Option 2: passenger accept => status stays "ready"
# - Driver API includes "ready" only when passenger_fare_response="accepted"
# - Adds /ride/track?code=... passenger tracking page (static map + live marker polling)
# PS5-safe. Writes UTF-8 (no BOM).

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $dir = Split-Path $path -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$path, [string]$bakDir, [string]$ts) {
  if (Test-Path $path) {
    $name = Split-Path $path -Leaf
    $dst = Join-Path $bakDir ("{0}.bak.{1}" -f $name, $ts)
    Copy-Item -Force $path $dst
    Ok ("[OK] Backup: {0}" -f $dst)
  } else {
    Warn ("[WARN] Missing (no backup): {0}" -f $path)
  }
}

# Must run at repo root (package.json exists)
$root = (Get-Location).Path
if (!(Test-Path (Join-Path $root "package.json"))) {
  Fail "Run this script from your Next.js repo root (where package.json exists)."
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

# Paths
$fareResp = Join-Path $root "app\api\passenger\fare-response\route.ts"
$driverActiveTrip = Join-Path $root "app\api\driver\active-trip\route.ts"
$passTrackApi = Join-Path $root "app\api\passenger\track\route.ts"
$trackPage = Join-Path $root "app\ride\track\page.tsx"
$trackClient = Join-Path $root "app\ride\track\TrackClient.tsx"

BackupFile $fareResp $bakDir $ts
BackupFile $driverActiveTrip $bakDir $ts

# 1) PATCH: /api/passenger/fare-response (Option 2)
# Accept => passenger_fare_response="accepted", status="ready" (keep ready)
# Decline => passenger_fare_response="declined", status="accepted", proposed_fare=null (driver can re-propose)
$fareRespContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}
function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  return { url, key };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const booking_id = String(body?.booking_id || "").trim();
    const booking_code = String(body?.booking_code || "").trim();
    const raw = String(body?.response || "").trim().toLowerCase(); // accepted | declined | rejected

    if ((!booking_id || !isUuidLike(booking_id)) && !booking_code) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING" }, { status: 400 });
    }

    // accept synonyms
    const response =
      raw === "accepted" ? "accepted" :
      (raw === "declined" || raw === "rejected") ? "declined" :
      "";

    if (!response) {
      return NextResponse.json({ ok: false, code: "INVALID_RESPONSE" }, { status: 400 });
    }

    const env = getSupabaseEnv();
    if (!env.url || !env.key) {
      return NextResponse.json({ ok: false, code: "MISSING_SUPABASE_ENV" }, { status: 500 });
    }
    const supabase = createClient(env.url, env.key);

    const match = booking_id ? { id: booking_id } : { booking_code };

    // OPTION 2 (your choice):
    // - accepted => keep status="ready" so dispatch/driver lifecycle can proceed cleanly
    // - declined => keep driver accepted, clear fare so driver can propose again
    const patch =
      response === "accepted"
        ? { passenger_fare_response: "accepted", status: "ready", updated_at: new Date().toISOString() }
        : { passenger_fare_response: "declined", status: "accepted", proposed_fare: null, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from("bookings")
      .update(patch)
      .match(match)
      .select("id, booking_code, status, proposed_fare, passenger_fare_response, driver_id, assigned_driver_id, updated_at")
      .limit(1);

    if (error) {
      return NextResponse.json({ ok: false, code: "DB_ERROR", message: error.message }, { status: 500 });
    }

    const row = Array.isArray(data) && data.length ? data[0] : null;
    return NextResponse.json({ ok: true, booking: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", message: String(e?.message || e) }, { status: 500 });
  }
}
'@

WriteUtf8NoBom $fareResp $fareRespContent
Ok "[OK] Patched: app/api/passenger/fare-response/route.ts"

# 2) PATCH: /api/driver/active-trip to include "ready" ONLY when passenger accepted
if (!(Test-Path $driverActiveTrip)) { Fail "Missing: $driverActiveTrip" }
$kt = Get-Content -Raw -Path $driverActiveTrip

# Add "ready" to activeStatuses list (if not present)
if ($kt -notmatch '"ready"') {
  $kt = $kt -replace 'const activeStatuses = \[([^\]]+)\];', 'const activeStatuses = [$1, "ready"];'
}

# Strengthen movement/selection: ignore "ready" unless passenger accepted
if ($kt -notmatch 'function isReadyButNotAccepted') {
  $insert = @'
    function isReadyButNotAccepted(r: any): boolean {
      const st = String((r as any)?.status ?? "");
      if (st !== "ready") return false;
      const pr = String((r as any)?.passenger_fare_response ?? "").toLowerCase();
      return pr !== "accepted";
    }
'@
  $kt = $kt -replace 'function isMovementState\(st: string\): boolean \{\s*return st === "on_the_way" \|\| st === "arrived" \|\| st === "on_trip";\s*\}\s*', ('$0' + "`r`n`r`n" + $insert + "`r`n")
}

# In the pick loop, skip ready if not accepted
if ($kt -notmatch 'isReadyButNotAccepted') {
  # If the file changes later, fail loudly rather than corrupt it.
  Fail "Could not inject ready-guard (unexpected driver/active-trip structure). Upload app/api/driver/active-trip/route.ts if this happens."
}

# Ensure selection loop skips ready-not-accepted
if ($kt -notmatch 'if \(isReadyButNotAccepted\(r\)\) continue;') {
  $kt = $kt -replace 'if \(isMovementState\(st\) && !hasFareEvidence\(r\)\) continue;', 'if (isMovementState(st) && !hasFareEvidence(r)) continue;`r`n      if (isReadyButNotAccepted(r)) continue;'
}

WriteUtf8NoBom $driverActiveTrip $kt
Ok "[OK] Patched: app/api/driver/active-trip/route.ts (includes ready when passenger accepted)"

# 3) ADD: /api/passenger/track (booking + latest driver location)
$passTrackContent = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

function clean(s: any){ return String(s ?? "").trim(); }

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const booking_code = clean(url.searchParams.get("booking_code") || url.searchParams.get("code"));
    if (!booking_code) {
      return NextResponse.json({ ok: false, error: "booking_code required" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    const { data: rows, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_code", booking_code)
      .limit(1);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const booking: any = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!booking) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const driverId = String(booking.driver_id || booking.assigned_driver_id || "").trim();

    let driver_location: any = null;
    if (driverId) {
      // Prefer your existing view used by dispatch/admin
      const dl = await supabase
        .from("dispatch_driver_locations_view")
        .select("*")
        .eq("driver_id", driverId)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (!dl.error && Array.isArray(dl.data) && dl.data.length) {
        driver_location = dl.data[0];
      }
    }

    return NextResponse.json({
      ok: true,
      booking_code,
      booking,
      driver_location,
      convenience_fee: 15,
      now: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store, max-age=0" }});
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
'@

WriteUtf8NoBom $passTrackApi $passTrackContent
Ok "[OK] Added: app/api/passenger/track/route.ts"

# 4) ADD: Passenger page /ride/track?code=...
$trackPageContent = @'
import TrackClient from "./TrackClient";

export default function Page({ searchParams }: { searchParams: any }) {
  const code = String(searchParams?.code || searchParams?.booking_code || "").trim();
  return <TrackClient code={code} />;
}
'@
WriteUtf8NoBom $trackPage $trackPageContent
Ok "[OK] Added: app/ride/track/page.tsx"

$trackClientContent = @'
"use client";

import React, { useEffect, useMemo, useState } from "react";

type AnyRec = Record<string, any>;

function money(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return "PHP " + x.toFixed(0);
}

function buildStaticMapUrl(args: {
  token: string;
  pickup?: { lat: number; lng: number };
  dropoff?: { lat: number; lng: number };
  driver?: { lat: number; lng: number };
}) {
  const { token, pickup, dropoff, driver } = args;
  const pins: string[] = [];

  // Mapbox pin formats: pin-s / pin-l (size), +color, label
  if (pickup) pins.push(`pin-s-a+2ecc71(${pickup.lng},${pickup.lat})`);
  if (dropoff) pins.push(`pin-s-b+e74c3c(${dropoff.lng},${dropoff.lat})`);
  if (driver) pins.push(`pin-l-car+3b82f6(${driver.lng},${driver.lat})`);

  const overlay = pins.join(",");
  const base = "https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/";
  const geo = overlay ? overlay + "/auto" : "auto";
  const size = "900x520";
  return `${base}${geo}/${size}?padding=80&access_token=${encodeURIComponent(token)}`;
}

export default function TrackClient({ code }: { code: string }) {
  const MAPBOX_TOKEN =
    (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
      "") as string;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<AnyRec | null>(null);
  const [last, setLast] = useState<string>("");

  async function refresh() {
    if (!code) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/passenger/track?booking_code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "TRACK_FAILED");
      setData(j);
      setLast(new Date().toLocaleTimeString());
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const booking = data?.booking || null;
  const dl = data?.driver_location || null;

  const pickup = useMemo(() => {
    const lat = Number(booking?.pickup_lat);
    const lng = Number(booking?.pickup_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [booking]);

  const dropoff = useMemo(() => {
    const lat = Number(booking?.dropoff_lat);
    const lng = Number(booking?.dropoff_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [booking]);

  const driver = useMemo(() => {
    const lat = Number(dl?.lat ?? dl?.latitude);
    const lng = Number(dl?.lng ?? dl?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [dl]);

  const status = String(booking?.status || "");
  const proposedFare = booking?.proposed_fare;
  const paxResp = String(booking?.passenger_fare_response || "");
  const showFarePopup = status === "fare_proposed" && proposedFare != null && paxResp.toLowerCase() !== "accepted";

  async function sendFareResponse(resp: "accepted" | "declined") {
    if (!code) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/passenger/fare-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_code: code, response: resp }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.message || j?.code || "FARE_RESPONSE_FAILED");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  const fee = Number(data?.convenience_fee ?? 15);
  const paxTotal = Number(proposedFare ?? 0) + (Number.isFinite(fee) ? fee : 15);

  const mapUrl = useMemo(() => {
    if (!MAPBOX_TOKEN) return "";
    return buildStaticMapUrl({ token: MAPBOX_TOKEN, pickup: pickup || undefined, dropoff: dropoff || undefined, driver: driver || undefined });
  }, [MAPBOX_TOKEN, pickup, dropoff, driver]);

  function openGoogleRoute() {
    if (!pickup || !dropoff) return;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${pickup.lat},${pickup.lng}&destination=${dropoff.lat},${dropoff.lng}&travelmode=driving`;
    window.open(url, "_blank");
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xl font-semibold">JRide Passenger Tracking</div>
            <div className="text-sm opacity-70">Booking code: <span className="font-mono">{code || "(missing)"}</span></div>
          </div>
          <button
            className="rounded-xl border border-black/10 px-3 py-2 text-sm hover:bg-black/5"
            onClick={refresh}
            disabled={!code || loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {err ? (
          <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">Error: {err}</div>
        ) : null}

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold">Status</div>
            <div className="mt-1 text-lg">{status || "-"}</div>
            <div className="mt-1 text-xs opacity-60">Last update: {last || "-"}</div>

            <div className="mt-3 text-sm">
              <div><span className="opacity-70">Pickup:</span> {pickup ? `${pickup.lat.toFixed(6)}, ${pickup.lng.toFixed(6)}` : "-"}</div>
              <div><span className="opacity-70">Dropoff:</span> {dropoff ? `${dropoff.lat.toFixed(6)}, ${dropoff.lng.toFixed(6)}` : "-"}</div>
              <div className="mt-2"><span className="opacity-70">Driver:</span> {driver ? `${driver.lat.toFixed(6)}, ${driver.lng.toFixed(6)}` : "-"}</div>
            </div>

            <button
              className="mt-3 w-full rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={openGoogleRoute}
              disabled={!pickup || !dropoff}
            >
              Open Route in Google Maps
            </button>
          </div>

          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold">Map</div>
            {!MAPBOX_TOKEN ? (
              <div className="mt-2 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-800">
                Mapbox token missing. Set <span className="font-mono">NEXT_PUBLIC_MAPBOX_TOKEN</span> (or <span className="font-mono">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</span>).
              </div>
            ) : mapUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="mt-2 w-full rounded-xl border border-black/10" src={mapUrl} alt="map" />
            ) : (
              <div className="mt-2 rounded-xl bg-black/5 p-3 text-sm">Waiting for coordinates...</div>
            )}

            <div className="mt-2 text-xs opacity-60">
              Markers: A=pickup, B=dropoff, car=driver (updates every 3s).
            </div>
          </div>
        </div>
      </div>

      {showFarePopup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-lg">
            <div className="text-lg font-semibold">Fare Proposal</div>
            <div className="mt-2 text-sm">
              Proposed fare: <span className="font-semibold">{money(proposedFare)}</span><br/>
              Convenience fee: <span className="font-semibold">{money(fee)}</span><br/>
              Passenger total: <span className="font-semibold">{money(paxTotal)}</span>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="flex-1 rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => sendFareResponse("accepted")}
                disabled={loading}
              >
                OK / Proceed
              </button>
              <button
                className="flex-1 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => sendFareResponse("declined")}
                disabled={loading}
              >
                Decline / Re-route
              </button>
            </div>

            <div className="mt-2 text-xs opacity-60">
              Accept keeps status at <span className="font-mono">ready</span>. Decline clears fare so driver can propose again.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
'@

WriteUtf8NoBom $trackClient $trackClientContent
Ok "[OK] Added: app/ride/track/TrackClient.tsx"

Ok "=== DONE: Passenger web tracking + ready flow patches applied ==="
Ok "[NEXT] Test: /ride/track?code=JR-... then propose fare -> passenger accept -> driver sees READY trip."
