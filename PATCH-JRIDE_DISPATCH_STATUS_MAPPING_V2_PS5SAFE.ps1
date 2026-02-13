# PATCH-JRIDE_DISPATCH_STATUS_MAPPING_V2_PS5SAFE.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Fail($m){ Write-Host $m -ForegroundColor Red }

$RepoRoot = (Get-Location).Path
Ok "== JRIDE PATCH: dispatch/status mapping (V2) =="

# Find the route.ts containing driverStatusForBookingStatus
$hits = @(
  Get-ChildItem -Path $RepoRoot -Recurse -File -Filter "route.ts" -ErrorAction SilentlyContinue |
    Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match "driverStatusForBookingStatus" }
)
if ($hits.Length -eq 0) { Fail "[FAIL] Could not find dispatch/status route.ts"; exit 1 }
$target = $hits[0].FullName
Ok ("Target: {0}" -f $target)

$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("dispatch-status.route.ts.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$src = Get-Content -LiteralPath $target -Raw

# Replace function body
$src2 = [regex]::Replace(
  $src,
  '(?s)function driverStatusForBookingStatus\(s: string\)\s*\{.*?\n\}',
@'
function driverStatusForBookingStatus(s: string) {
  const x = (s || "").toLowerCase();
  // Driver is only "busy" AFTER passenger accepted / trip started.
  if (x === "completed" || x === "cancelled") return "online";
  if (x === "pending" || x === "assigned") return "online";
  if (x === "accepted" || x === "on_the_way" || x === "arrived" || x === "on_trip") return "on_trip";
  return null;
}
'@,
  1
)

[System.IO.File]::WriteAllText($target, $src2, (New-Object System.Text.UTF8Encoding($false)))
Ok "[OK] Patched mapping"
Ok "== DONE =="
