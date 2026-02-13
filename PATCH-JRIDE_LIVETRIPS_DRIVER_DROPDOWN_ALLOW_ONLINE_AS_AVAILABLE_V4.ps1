# PATCH-JRIDE_LIVETRIPS_DRIVER_DROPDOWN_ALLOW_ONLINE_AS_AVAILABLE_V4.ps1
# Goal: Treat driver status "online" as "available" for manual assignment dropdown + helper logic.
# Safe: targeted string/regex edits with backups.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw

# --- Patch 1: isAvail() helper ---
# Replace isAvail body to accept available OR online (case-insensitive).
$re1 = [regex]'function\s+isAvail\s*\(\s*d\s*:\s*any\s*\)\s*\{\s*return\s+normStatus\(\s*d\?\.status\s*\)\s*===\s*"available"\s*;\s*\}'
if ($re1.IsMatch($txt)) {
  $txt = $re1.Replace($txt, 'function isAvail(d: any) { const s = normStatus(d?.status); return s === "available" || s === "online"; }', 1)
  Write-Host "[OK] Patched isAvail(): available OR online"
} else {
  # fallback if formatting differs
  $re1b = [regex]'function\s+isAvail\s*\(\s*d\s*:\s*any\s*\)\s*\{[^}]*\}'
  if ($re1b.IsMatch($txt)) {
    $txt = $re1b.Replace($txt, 'function isAvail(d: any) { const s = normStatus(d?.status); return s === "available" || s === "online"; }', 1)
    Write-Host "[OK] Patched isAvail() via fallback"
  } else {
    Write-Host "[WARN] Could not find isAvail() to patch (file changed)."
  }
}

# --- Patch 2: manualDriverIsAvailable line ---
# Change it to accept available OR online.
$re2 = [regex]'const\s+manualDriverIsAvailable\s*=\s*normStatus\(\s*\(selectedDriver\s+as\s+any\)\?\.status\s*\)\s*===\s*"available"\s*;'
if ($re2.IsMatch($txt)) {
  $txt = $re2.Replace($txt, 'const manualDriverIsAvailable = (() => { const s = normStatus((selectedDriver as any)?.status); return s === "available" || s === "online"; })();', 1)
  Write-Host "[OK] Patched manualDriverIsAvailable: available OR online"
} else {
  Write-Host "[WARN] Could not find manualDriverIsAvailable line to patch (file changed)."
}

Set-Content -Path $target -Value $txt -Encoding UTF8
Write-Host "[DONE] LiveTripsClient patched."
