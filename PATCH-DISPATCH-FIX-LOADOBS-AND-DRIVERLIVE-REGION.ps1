param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw $m }

$path = "app\dispatch\page.tsx"
if (!(Test-Path $path)) { Fail "File not found: $path" }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$path.bak.$ts"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $path -Raw
$before = $txt

# Replace the broken loadObs() region that contains the injected loadDriversLive() + stray ');'
# We anchor on:
#   async function loadObs() {
#     const r = await fetch("/api/dispatch/status?log=1", { cache: "no-store" });
#   // Driver live telemetry...
#   async function loadDriversLive() { ... }
# );
#     const j = await r.json()...
#     if (...) setObs(...)
#   }
#
# Then we rewrite it cleanly as two separate functions.

$pattern = '(?s)async\s+function\s+loadObs\s*\(\)\s*\{\s*' +
           'const\s+r\s*=\s*await\s+fetch\(\s*["'']/api/dispatch/status\?log=1["'']\s*,\s*\{\s*cache\s*:\s*["'']no-store["'']\s*\}\s*\)\s*;\s*' +
           '\/\/\s*Driver\s+live\s+telemetry\s*\(read-only;\s*optional\)\s*' +
           'async\s+function\s+loadDriversLive\s*\(\)\s*\{.*?\}\s*' +
           '\)\s*;\s*' +
           'const\s+j\s*=\s*await\s+r\.json\(\)\.catch\(\(\)\s*=>\s*\(\s*\{\s*\}\s*\)\s*\)\s*;\s*' +
           'if\s*\(\s*j\?\.\s*ok\s*&&\s*Array\.isArray\(\s*j\.actions\s*\)\s*\)\s*setObs\(\s*j\.actions\s*\)\s*;\s*' +
           '\}\s*'

if ($txt -notmatch $pattern) {
  Fail @"
Could not find the exact broken loadObs/loadDriversLive region to replace.
This script expects the injected 'loadDriversLive()' to be inside 'loadObs()' and a stray ');' line.
Paste again this exact 25-40 line window:
powershell -NoProfile -Command "Get-Content app\dispatch\page.tsx | Select-Object -Skip 395 -First 55"
"@
}

$replacement = @'
async function loadObs() {
  const r = await fetch("/api/dispatch/status?log=1", { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (j?.ok && Array.isArray(j.actions)) setObs(j.actions);
}

// Driver live telemetry (read-only; optional)
async function loadDriversLive() {
  try {
    const r = await fetch("/api/dispatch/drivers-live", { cache: "no-store" });
    const j = await r.json().catch(() => ({} as any));
    if (j?.ok && j?.drivers && typeof j.drivers === "object") {
      setDriverLiveMap(j.drivers);
    }
  } catch {
    // silent: telemetry optional
  }
}
'@

$txt = [regex]::Replace($txt, $pattern, $replacement)

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Rewrote broken loadObs() and split loadDriversLive() to component scope."
Ok "Wrote: $path"

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "npm.cmd run build" -ForegroundColor Cyan
