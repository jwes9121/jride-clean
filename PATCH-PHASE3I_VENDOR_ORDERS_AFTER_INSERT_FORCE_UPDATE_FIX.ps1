# PATCH-PHASE3I_VENDOR_ORDERS_AFTER_INSERT_FORCE_UPDATE_FIX.ps1
# Fixes compile error by removing resolved_pickup/resolved_dropoff references
# and using pickupLL / dropoffLL which exist in scope.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$target = "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing $target" }

$src = [System.IO.File]::ReadAllText((Resolve-Path $target), [System.Text.Encoding]::UTF8)

if ($src -notmatch "PHASE3I_AFTER_INSERT_FORCE_UPDATE") {
  Fail "Could not find PHASE3I_AFTER_INSERT_FORCE_UPDATE block. Did you apply the previous patch?"
}

$src2 = $src

# Replace the four lines that reference resolved_pickup/resolved_dropoff
$src2 = $src2 -replace '\(resolved_pickup\s+as\s+any\)\?\.(lat|lng)\s+\?\?\s*', ''
$src2 = $src2 -replace '\(resolved_dropoff\s+as\s+any\)\?\.(lat|lng)\s+\?\?\s*', ''

# Now ensure the payload lines use pickupLL/dropoffLL explicitly
# (in case earlier text still has vendorLL/dropoffLL fallback, we force it to the simplest safe form)
$src2 = $src2 -replace '(pickup_lat:\s*)([^,\r\n]+)', '$1(pickupLL as any)?.lat ?? null'
$src2 = $src2 -replace '(pickup_lng:\s*)([^,\r\n]+)', '$1(pickupLL as any)?.lng ?? null'
$src2 = $src2 -replace '(dropoff_lat:\s*)([^,\r\n]+)', '$1(dropoffLL as any)?.lat ?? null'
$src2 = $src2 -replace '(dropoff_lng:\s*)([^,\r\n]+)', '$1(dropoffLL as any)?.lng ?? null'

if ($src2 -eq $src) { Fail "No changes applied. Paste the PHASE3I_AFTER_INSERT_FORCE_UPDATE block from route.ts." }

$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

[System.IO.File]::WriteAllText((Resolve-Path $target), $src2, [System.Text.Encoding]::UTF8)
Ok "Patched: $target"
Ok "Resolved compile error: now using pickupLL/dropoffLL."
