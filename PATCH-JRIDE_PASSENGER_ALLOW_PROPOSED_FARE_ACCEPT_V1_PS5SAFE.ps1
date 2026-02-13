# PATCH-JRIDE_PASSENGER_ALLOW_PROPOSED_FARE_ACCEPT_V1_PS5SAFE.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Fail($m){ Write-Host $m -ForegroundColor Red }

$RepoRoot = (Get-Location).Path
Ok "== JRIDE PATCH: passenger can accept proposed fare (V1) =="

# Find app/ride/page.tsx
$hits = @(
  Get-ChildItem -Path $RepoRoot -Recurse -File -Filter "page.tsx" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\app\\ride\\page\.tsx$" }
)

if ($hits.Length -eq 0) { Fail "[FAIL] app/ride/page.tsx not found."; exit 1 }
$target = $hits[0].FullName
Ok ("Target: {0}" -f $target)

$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("ride.page.tsx.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$src = Get-Content -LiteralPath $target -Raw

# Replace:
# const pending = ...; const canAct = pending && (liveBooking as any)?.verified_fare != null;
# with:
# canAct = pending && (proposed_fare != null || verified_fare != null);
$src2 = $src -replace `
'const pending = \(\!resp \|\| resp === "pending"\);\s*const canAct = pending && \(liveBooking as any\)\?\.verified_fare != null;',
'const pending = (!resp || resp === "pending"); const lb: any = (liveBooking as any) || null; const canAct = pending && (lb?.verified_fare != null || lb?.proposed_fare != null);'

[System.IO.File]::WriteAllText($target, $src2, (New-Object System.Text.UTF8Encoding($false)))
Ok "[OK] Patched gating to allow proposed_fare"
Ok "== DONE =="
