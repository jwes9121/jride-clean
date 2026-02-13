# PATCH-DISPATCH-DRIVER-HEALTH-ADD-HELPERS.ps1
# Fix compile: ensure minsAgo/isStale/deriveDriverState helpers exist (module scope)
# Touches ONLY: app\dispatch\page.tsx
# Reversible via backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$ui = "app\dispatch\page.tsx"
if (-not (Test-Path $ui)) { Fail "Missing file: $ui (run from repo root)" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$ui.bak.$stamp"
Copy-Item -Force $ui $bak
Ok "Backup UI: $bak"

$txt = Get-Content $ui -Raw

# If already present, do nothing
if ($txt -match 'function\s+deriveDriverState\s*\(') {
  Warn "deriveDriverState already present. No changes made."
  exit 0
}

# Find normStatus block end to insert right after it.
$rxNorm = '(?s)(function\s+normStatus\s*\([\s\S]*?\)\s*\{[\s\S]*?\}\s*)'
$m = [regex]::Match($txt, $rxNorm)
if (-not $m.Success) { Fail "Could not locate normStatus() block to anchor helper insertion." }

$helpers = @"
  /* JRIDE_UI_DRIVER_HEALTH_HELPERS_START */
  function minsAgo(iso?: string | null) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    const diffMs = Date.now() - t;
    if (diffMs < 0) return 0;
    return Math.floor(diffMs / 60000);
  }

  function isStale(iso?: string | null, staleMins = 5) {
    const m = minsAgo(iso);
    if (m === null) return true; // unknown -> treat stale for safety
    return m >= staleMins;
  }

  // Canonical derived state for dispatch display.
  // Booking status wins (busy), otherwise use last-seen + live status.
  function deriveDriverState(bookingStatusRaw: any, liveStatusRaw: any, lastSeenIso?: string | null) {
    const bs = normStatus(String(bookingStatusRaw ?? ""));
    const ls = String(liveStatusRaw ?? "").trim().toLowerCase();

    if (bs === "on_trip") return "on_trip";
    if (bs === "on_the_way") return "on_the_way";
    if (bs === "assigned") return "assigned";

    if (isStale(lastSeenIso, 5)) return "offline";
    if (ls === "offline") return "offline";
    if (ls === "online") return "online";

    return "online";
  }
  /* JRIDE_UI_DRIVER_HEALTH_HELPERS_END */

"@

$normBlock = $m.Groups[1].Value
$txt2 = $txt.Replace($normBlock, ($normBlock + "`n" + $helpers))
if ($txt2 -eq $txt) { Fail "No change produced (unexpected)." }

Set-Content -Path $ui -Value $txt2 -Encoding UTF8
Ok "Inserted Driver Health helpers after normStatus()."

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "npm run build" -ForegroundColor Cyan
