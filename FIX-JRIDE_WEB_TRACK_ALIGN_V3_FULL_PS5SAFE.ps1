param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Backup-File {
  param([string]$Path)

  $dir = Split-Path -Parent $Path
  $bakDir = Join-Path $dir "_patch_bak"
  if (!(Test-Path $bakDir)) {
    New-Item -Path $bakDir -ItemType Directory | Out-Null
  }

  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path $Path -Leaf
  $bak = Join-Path $bakDir ($name + ".WEB_TRACK_ALIGN_V3_FULL." + $stamp + ".bak")
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Content
  )
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$adminPath = Join-Path $WebRoot "app\api\admin\driver_locations\route.ts"
$ridePagePath = Join-Path $WebRoot "app\ride\page.tsx"
$trackClientPath = Join-Path $WebRoot "app\ride\track\TrackClient.tsx"

if (!(Test-Path $adminPath)) {
  throw "File not found: $adminPath"
}
if (!(Test-Path $ridePagePath)) {
  throw "File not found: $ridePagePath"
}
if (!(Test-Path $trackClientPath)) {
  throw "File not found: $trackClientPath"
}

$adminRaw = Get-Content -LiteralPath $adminPath -Raw -Encoding UTF8
if ($adminRaw -notmatch 'assign_eligible\s*:\s*assignEligible') {
  throw "Admin route is not in the expected aligned state. Expected assign_eligible: assignEligible in $adminPath"
}

Backup-File $ridePagePath
Backup-File $trackClientPath

$ridePageNew = @'
"use client";

import { useEffect, useMemo, useState } from "react";

type TrackPayload = {
  ok?: boolean;
  booking_code?: string | null;
  status?: string | null;
  driver?: {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
  } | null;
  route?: {
    distance_km?: number | null;
    eta_minutes?: number | null;
    trip_km?: number | null;
  } | null;
  proposed_fare?: number | null;
  verified_fare?: number | null;
  message?: string | null;
};

function money(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? `PHP ${v.toFixed(2)}` : "--";
}

function metricKm(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} km` : "--";
}

function metricMin(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? `${Math.round(v)} min` : "--";
}

export default function RidePage() {
  const [data, setData] = useState<TrackPayload | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const code = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    return (
      url.searchParams.get("booking_code") ||
      url.searchParams.get("code") ||
      ""
    ).trim();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchTrack() {
      if (!code) {
        if (!cancelled) {
          setErr("Missing booking code.");
          setData(null);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setLoading(true);
        setErr("");
      }

      try {
        const res = await fetch(
          `/api/passenger/track?booking_code=${encodeURIComponent(code)}&ts=${Date.now()}`,
          { cache: "no-store" }
        );

        const json = await res.json().catch(() => null);

        if (!cancelled) {
          if (!res.ok || !json?.ok) {
            setData(null);
            setErr(json?.message || "Unable to load trip tracking.");
          } else {
            setData(json);
          }
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setErr("Unable to load trip tracking.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchTrack();
    const t = setInterval(fetchTrack, 3000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [code]);

  const statusSteps = [
    "searching",
    "assigned",
    "accepted",
    "fare_proposed",
    "ready",
    "on_the_way",
    "arrived",
    "on_trip",
    "completed",
  ];

  const currentIndex = statusSteps.indexOf((data?.status || "").trim());

  return (
    <div className="mx-auto max-w-xl p-4">
      <div className="mb-4 rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Trip Tracking</div>
        <div className="text-xs opacity-70">Code: {code || "--"}</div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {statusSteps.map((s, i) => (
          <div
            key={s}
            className={
              "rounded p-2 text-center text-xs " +
              (i < currentIndex
                ? "bg-emerald-700 text-white"
                : i === currentIndex
                ? "bg-emerald-500 text-white"
                : "bg-gray-700 text-gray-300")
            }
          >
            {s.replaceAll("_", " ")}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="mb-4 rounded-xl border border-black/10 bg-white p-4 text-sm">
          Loading trip tracking...
        </div>
      ) : null}

      {err ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-black/10 bg-white p-4 space-y-2">
            <div>Status: {data.status || "--"}</div>
            <div>Driver: {data.driver?.name || "--"}</div>
            <div>Phone: {data.driver?.phone || "--"}</div>
            <div>Pickup distance: {metricKm(data.route?.distance_km)}</div>
            <div>ETA: {metricMin(data.route?.eta_minutes)}</div>
            <div>Trip distance: {metricKm(data.route?.trip_km)}</div>
            <div>Fare: {money(data.verified_fare ?? data.proposed_fare ?? null)}</div>
          </div>

          {data.status === "completed" ? (
            <div className="space-y-2">
              <button className="w-full rounded bg-green-500 p-3 text-white">
                Book Again
              </button>
              <button className="w-full rounded bg-gray-600 p-3 text-white">
                View Receipt
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
'@

$trackClientNew = @'
"use client";

import { useEffect, useState } from "react";

type TrackResponse = {
  ok?: boolean;
  booking_code?: string | null;
  status?: string | null;
  driver?: {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
  } | null;
  route?: {
    distance_km?: number | null;
    eta_minutes?: number | null;
    trip_km?: number | null;
  } | null;
  proposed_fare?: number | null;
  verified_fare?: number | null;
  message?: string | null;
};

function money(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? `PHP ${v.toFixed(2)}` : "--";
}

export default function TrackClient({ code }: { code?: string }) {
  const [data, setData] = useState<TrackResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function fetchTrack() {
    if (!code) {
      setErr("Missing booking code.");
      setData(null);
      return;
    }

    setLoading(true);
    setErr("");

    try {
      const res = await fetch(
        `/api/passenger/track?booking_code=${encodeURIComponent(code)}&ts=${Date.now()}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setData(null);
        setErr(json?.message || "Unable to load trip tracking.");
        return;
      }

      setData(json);
    } catch {
      setData(null);
      setErr("Unable to load trip tracking.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTrack();
    const t = setInterval(fetchTrack, 3000);
    return () => clearInterval(t);
  }, [code]);

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Tracking</div>
        <div className="text-xs opacity-70">Code: {code || "--"}</div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-black/10 bg-white p-4 text-sm">
          Loading tracking...
        </div>
      ) : null}

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {data ? (
        <div className="rounded-xl border border-black/10 bg-white p-4 space-y-2">
          <div>Status: {data.status ?? "--"}</div>
          <div>Driver: {data.driver?.name ?? "--"}</div>
          <div>Phone: {data.driver?.phone ?? "--"}</div>
          <div>
            Pickup distance:{" "}
            {typeof data.route?.distance_km === "number"
              ? `${data.route.distance_km.toFixed(1)} km`
              : "--"}
          </div>
          <div>
            ETA:{" "}
            {typeof data.route?.eta_minutes === "number"
              ? `${Math.round(data.route.eta_minutes)} min`
              : "--"}
          </div>
          <div>
            Trip distance:{" "}
            {typeof data.route?.trip_km === "number"
              ? `${data.route.trip_km.toFixed(1)} km`
              : "--"}
          </div>
          <div className="font-semibold">
            Fare: {money(data.verified_fare ?? data.proposed_fare ?? null)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
'@

Write-Utf8NoBom -Path $ridePagePath -Content $ridePageNew
Write-Host "[OK] Rewrote: $ridePagePath"

Write-Utf8NoBom -Path $trackClientPath -Content $trackClientNew
Write-Host "[OK] Rewrote: $trackClientPath"

Write-Host ""
Write-Host "=== VERIFY ==="
Select-String -Path $adminPath, $ridePagePath, $trackClientPath -Pattern "assign_eligible|assignEligible|/api/passenger/track|haversine|/api/public/passenger/booking"

Write-Host ""
Write-Host "[DONE] Web ride tracking files are aligned to the unified passenger track route. Admin eligibility was already aligned."