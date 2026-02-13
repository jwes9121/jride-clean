# PATCH-PHASE3I_VENDOR_ORDERS_CREATEPAYLOAD_USE_TOPLEVEL_COORDS_V2.ps1
# Exact string replacements (no regex) to avoid PowerShell escaping issues.
# Replaces createPayload coord sources:
#   pickup_*  (pickupLL) -> (vendorLL)
#   dropoff_* (dropLL)   -> (dropoffLL)
# ASCII-safe; creates .bak backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$target = Join-Path (Get-Location).Path "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing: $target" }

$src = Get-Content -Raw -Encoding UTF8 $target
$orig = $src

$src = $src.Replace("pickup_lat: (pickupLL as any).lat,",  "pickup_lat: (vendorLL as any).lat,")
$src = $src.Replace("pickup_lng: (pickupLL as any).lng,",  "pickup_lng: (vendorLL as any).lng,")
$src = $src.Replace("dropoff_lat: (dropLL as any).lat,",   "dropoff_lat: (dropoffLL as any).lat,")
$src = $src.Replace("dropoff_lng: (dropLL as any).lng,",   "dropoff_lng: (dropoffLL as any).lng,")

if ($src -eq $orig) { Fail "No changes applied. Those exact coord lines were not found. Paste the 15 lines around createPayload coords." }

$bak = "$target.bak.$ts"
Copy-Item -Force $target $bak
Ok "Backup: $bak"

Set-Content -Encoding UTF8 -NoNewline -Path $target -Value $src
Ok "Patched: $target"
Ok "CREATE payload now uses vendorLL for pickup and dropoffLL for dropoff."
