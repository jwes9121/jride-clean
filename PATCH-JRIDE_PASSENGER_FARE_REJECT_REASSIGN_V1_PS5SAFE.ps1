# PATCH-JRIDE_PASSENGER_FARE_REJECT_REASSIGN_V1_PS5SAFE.ps1
# Patch passenger fare reject route.ts to:
# - passenger_fare_response = "rejected"
# - status = "pending"
# - clear driver assignment + fare fields for reassignment

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }

$RepoRoot = (Get-Location).Path
Ok "== JRIDE PATCH: Passenger fare REJECT -> reset & reassignable (V1 / PS5-safe) =="
Ok ("RepoRoot: {0}" -f $RepoRoot)

# Find route.ts containing passenger_fare_response rejected
$hits = @(
  Get-ChildItem -Path $RepoRoot -Recurse -File -Filter "route.ts" -ErrorAction SilentlyContinue |
    Where-Object {
      try {
        $t = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop

        $hasReject = ($t -match 'passenger_fare_response\s*:\s*"rejected"') -or
                     ($t -match "passenger_fare_response\s*:\s*'rejected'")

        $looksLikeFareRoute = ($t -match 'fare/reject') -or ($t -match 'passenger_fare_response')

        $hasReject -and $looksLikeFareRoute
      } catch { $false }
    }
)

if ($hits.Length -eq 0) {
  Fail "[FAIL] Could not find the passenger fare reject route.ts by signature."
  Fail "Expected something like: app/api/**/fare/reject/route.ts"
  exit 1
}

if ($hits.Length -gt 1) {
  Warn "[WARN] Multiple matches; using first:"
  $hits | ForEach-Object { Write-Host (" - " + $_.FullName) -ForegroundColor Yellow }
}

$Target = $hits[0].FullName
Ok ("[OK] Target: {0}" -f $Target)

# Backup
$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("fare-reject.route.ts.bak." + $stamp)
Copy-Item -LiteralPath $Target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$src = Get-Content -LiteralPath $Target -Raw

# Replace .update({ passenger_fare_response: "rejected" }) with reset+reassignable update
$src2 = [regex]::Replace(
  $src,
  '(?s)\.update\(\s*\{\s*passenger_fare_response\s*:\s*"rejected"\s*\}\s*\)',
@'
.update({
        passenger_fare_response: "rejected",

        // Make booking re-dispatchable
        status: "pending",

        // Clear current driver assignment so next driver can be assigned
        driver_id: null,
        assigned_driver_id: null,
        assigned_at: null,

        // Clear fare so new driver can propose again
        proposed_fare: null,
        verified_fare: null,
        verified_by: null,
        verified_at: null,
        verified_reason: null,

        updated_at: new Date().toISOString(),
      })
'@,
  1
)

if ($src2 -eq $src) {
  Fail "[FAIL] Patch did not apply (expected update({ passenger_fare_response: \"rejected\" }) pattern)."
  Fail "Paste the reject route content here and I'll patch it exactly."
  exit 1
}

[System.IO.File]::WriteAllText($Target, $src2, (New-Object System.Text.UTF8Encoding($false)))
Ok "[OK] Patched reject route (UTF-8 no BOM)"
Ok "== DONE =="
