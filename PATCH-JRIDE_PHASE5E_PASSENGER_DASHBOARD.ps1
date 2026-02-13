$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

if (!(Test-Path ".\package.json")) { Fail "Run from repo root (package.json missing)." }
if (!(Test-Path ".\app")) { Fail "Expected ./app (Next.js App Router)." }

$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")

# --- pick best route by scanning the repo (no assumptions) ---
function PickRoute([string[]]$candidates){
  foreach($c in $candidates){
    $p = ".\app\" + ($c.TrimStart("/") -replace "/", "\") + "\page.tsx"
    if (Test-Path $p) { return $c }
  }
  return $null
}

$ride = PickRoute @("/book", "/ride", "/rides", "/booking", "/bookings", "/passenger/booking", "/passenger/book")
$takeout = PickRoute @("/takeout", "/food", "/food-delivery", "/passenger/takeout")
$errands = PickRoute @("/errands", "/errand", "/passenger/errands")

if (-not $ride) { $ride = "/passenger" }      # safe fallback (stays on dashboard)
if (-not $takeout) { $takeout = "/passenger" }
if (-not $errands) { $errands = "/passenger" }

Ok "[OK] Detected routes:"
Ok "     Ride:    $ride"
Ok "     Takeout: $takeout"
Ok "     Errands: $errands"

$targetDir = ".\app\passenger"
$target = ".\app\passenger\page.tsx"

if (!(Test-Path $targetDir)) {
  New-Item -ItemType Directory -Path $targetDir | Out-Null
  Ok "[OK] Created: $targetDir"
}

if (Test-Path $target) {
  Copy-Item $target "$target.bak.$ts" -Force
  Ok "[OK] Backup: $target.bak.$ts"
}

# --- Write full file ---
$code = @"
"use client";

import * as React from "react";

export default function PassengerDashboardPage() {
  // Pilot dashboard: keep it simple + stable.
  // We avoid assuming auth/session APIs here; this is just a landing.
  const rideHref = "$ride";
  const takeoutHref = "$takeout";
  const errandsHref = "$errands";

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-1">Passenger Dashboard</h1>
        <p className="text-sm opacity-80 mb-6">
          Welcome! Choose what you want to do.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <a
            className="rounded-xl border px-4 py-3 hover:bg-black/5"
            href={rideHref}
          >
            <div className="font-semibold">Book Ride</div>
            <div className="text-xs opacity-70">Go to ride booking</div>
          </a>

          <a
            className="rounded-xl border px-4 py-3 hover:bg-black/5"
            href={takeoutHref}
          >
            <div className="font-semibold">Takeout</div>
            <div className="text-xs opacity-70">Food delivery (pilot)</div>
          </a>

          <a
            className="rounded-xl border px-4 py-3 hover:bg-black/5"
            href={errandsHref}
          >
            <div className="font-semibold">Errands</div>
            <div className="text-xs opacity-70">Pabili / padala (pilot)</div>
          </a>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <a
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 font-semibold"
            href={rideHref}
          >
            Continue
          </a>

          <a
            className="inline-flex items-center justify-center rounded-xl border px-4 py-2 font-semibold"
            href="/passenger-login"
          >
            Back to Login
          </a>
        </div>

        <div className="mt-6 text-xs opacity-70">
          Note: This is the passenger landing page. Next step is to connect verification + night rules (8PM–5AM).
        </div>
      </div>
    </main>
  );
}
"@

[IO.File]::WriteAllText($target, $code, [Text.Encoding]::UTF8)
Ok "[OK] Wrote: $target"

Info "NEXT: npm.cmd run build"
