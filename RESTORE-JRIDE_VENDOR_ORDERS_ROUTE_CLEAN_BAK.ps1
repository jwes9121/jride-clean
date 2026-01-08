# RESTORE-JRIDE_VENDOR_ORDERS_ROUTE_CLEAN_BAK.ps1
# Restores app/api/vendor-orders/route.ts from the newest backup that does NOT contain
# "PHASE2D_VENDOR_ORDERS_SNAPSHOT_BEGIN" (clean pre-patch state).
# Saves current file as .broken.<timestamp> first.

$ErrorActionPreference = "Stop"

function OK($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function INFO($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function FAIL($m){ throw $m }
function TS(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$target = "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { FAIL "Missing $target" }

$dir  = Split-Path $target -Parent
$leaf = Split-Path $target -Leaf

$baks = Get-ChildItem -Path $dir -Filter "$leaf.bak.*" -File | Sort-Object LastWriteTime -Descending
if (!$baks -or $baks.Count -lt 1) { FAIL "No backups found: $dir\$leaf.bak.*" }

$chosen = $null
foreach ($b in $baks) {
  $txt = Get-Content -Raw $b.FullName
  if ($txt -notmatch "PHASE2D_VENDOR_ORDERS_SNAPSHOT_BEGIN") {
    $chosen = $b
    break
  }
}

if (-not $chosen) {
  FAIL "No clean backup found (all backups contain PHASE2D markers)."
}

INFO "Chosen clean backup: $($chosen.FullName)"

# Save current broken file
$broken = "$target.broken.$(TS)"
Copy-Item -Force $target $broken
OK "Saved current file as: $broken"

# Restore
Copy-Item -Force $chosen.FullName $target
OK "Restored: $target"

# Sanity check
$len = (Get-Item $target).Length
if ($len -lt 200) { FAIL "Restored file looks too small ($len bytes). Aborting." }
OK "Restored file size: $len bytes"
