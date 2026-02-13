# PATCH-FIX-T-NOT-DEFINED-AND-HIDE-PROBLEMROW.ps1
# - Removes stray "if (!t) return null;" that was injected in the wrong scope
# - Adds a safe render guard INSIDE visibleTrips.map((t)=>{ ... }) to hide shell/problem rows

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }

$ts = Stamp
$path = "app\admin\livetrips\LiveTripsClient.tsx"

if (!(Test-Path $path)) { Fail "Missing file: $path" }

Copy-Item $path "$path.bak.$ts" -Force
Write-Host "[OK] Backup: $path.bak.$ts" -ForegroundColor Green

# Read UTF-8 (no BOM)
$bytes = [System.IO.File]::ReadAllBytes($path)
$text = [System.Text.UTF8Encoding]::new($false).GetString($bytes)

# 1) Remove any stray injected line(s) that crash runtime
#    (do this first; it’s safe even if none exist)
$text2 = ($text -split "`n" | Where-Object { $_ -notmatch "^\s*if\s*\(\s*!\s*t\s*\)\s*return\s+null\s*;\s*$" }) -join "`n"

# 2) Remove any prior guard block to avoid duplicates (best-effort)
$text2 = $text2 -replace "(?s)\s*//\s*RENDER_GUARD_REAL_BOOKINGS_ONLY[\s\S]*?return\s+null;\s*\}\s*", ""

# 3) Insert correct guard INSIDE visibleTrips.map((t) => { ... })
$needle = "visibleTrips.map((t) => {"
if ($text2 -notmatch [regex]::Escape($needle)) {
  Fail "Could not find: $needle"
}

# If already inserted, skip
if ($text2 -match "RENDER_GUARD_REAL_BOOKINGS_ONLY") {
  Write-Host "[SKIP] Render guard already present." -ForegroundColor Yellow
} else {
  $guard = @'
                  // RENDER_GUARD_REAL_BOOKINGS_ONLY
                  // Hide synthetic/shell rows like booking_code="-----" with no meaningful fields.
                  const code = String(t?.booking_code ?? "").trim();
                  const codeLooksFake = !code || /^-+$/.test(code) || code.toLowerCase() === "null" || code.toLowerCase() === "undefined";

                  const hasPassenger = !!String(t?.passenger_name ?? "").trim();
                  const hasPickupLbl = !!String(t?.pickup_label ?? "").trim();
                  const hasDropLbl = !!String(t?.dropoff_label ?? "").trim();

                  const hasPickupCoords = Number.isFinite((t as any)?.pickup_lat) && Number.isFinite((t as any)?.pickup_lng);
                  const hasDropCoords = Number.isFinite((t as any)?.dropoff_lat) && Number.isFinite((t as any)?.dropoff_lng);

                  const meaningful = hasPassenger || hasPickupLbl || hasDropLbl || hasPickupCoords || hasDropCoords;

                  if (codeLooksFake && !meaningful) {
                    return null;
                  }
'@

  $text2 = $text2.Replace($needle, $needle + "`n" + $guard)
}

# Write UTF-8 (no BOM)
[System.IO.File]::WriteAllBytes($path, [System.Text.UTF8Encoding]::new($false).GetBytes($text2))

Write-Host "[DONE] Fixed 't is not defined' and added safe render guard." -ForegroundColor Green
Write-Host "NEXT: restart dev server, then run build/dev." -ForegroundColor Yellow
