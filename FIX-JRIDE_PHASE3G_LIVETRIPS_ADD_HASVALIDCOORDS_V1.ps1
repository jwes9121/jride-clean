# FIX-JRIDE_PHASE3G_LIVETRIPS_ADD_HASVALIDCOORDS_V1.ps1
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$repo = (Get-Location).Path
$target = Join-Path $repo "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content -LiteralPath $target -Raw

# If already present, do nothing
if ($txt -match "function\s+hasValidCoords\s*\(") {
  Write-Host "[OK] hasValidCoords() already exists. No change." -ForegroundColor Green
  exit 0
}

# Insert near other helpers: after hasDriver() if present, else after normStatus() if present, else after computeProblemReason() if present.
$insertAfterPatterns = @(
  '(?s)function\s+hasDriver\s*\([^\)]*\)\s*\{.*?\}\s*',
  '(?s)function\s+normStatus\s*\([^\)]*\)\s*\{.*?\}\s*',
  '(?s)function\s+computeProblemReason\s*\([^\)]*\)\s*\{.*?\}\s*'
)

$helper = @'

function hasValidCoords(t: any): boolean {
  const pLat = Number((t as any)?.pickup_lat ?? (t as any)?.pickupLatitude ?? (t as any)?.from_lat ?? (t as any)?.fromLat ?? null);
  const pLng = Number((t as any)?.pickup_lng ?? (t as any)?.pickupLongitude ?? (t as any)?.from_lng ?? (t as any)?.fromLng ?? null);
  const dLat = Number((t as any)?.dropoff_lat ?? (t as any)?.dropoffLatitude ?? (t as any)?.to_lat ?? (t as any)?.toLat ?? null);
  const dLng = Number((t as any)?.dropoff_lng ?? (t as any)?.dropoffLongitude ?? (t as any)?.to_lng ?? (t as any)?.toLng ?? null);

  const ok = (n: any) => Number.isFinite(n) && n !== 0;
  return ok(pLat) && ok(pLng) && ok(dLat) && ok(dLng);
}

'@

$did = $false
foreach ($pat in $insertAfterPatterns) {
  $m = [regex]::Match($txt, $pat)
  if ($m.Success) {
    $at = $m.Index + $m.Length
    $txt = $txt.Substring(0, $at) + $helper + $txt.Substring($at)
    $did = $true
    break
  }
}

if (!$did) {
  # Fallback: insert after imports block (first blank line after imports)
  $m2 = [regex]::Match($txt, "(?s)\A(.*?\r?\n)\r?\n")
  if (!$m2.Success) { Fail "Could not find a safe insertion point." }
  $at = $m2.Index + $m2.Length
  $txt = $txt.Substring(0, $at) + $helper + $txt.Substring($at)
}

Set-Content -LiteralPath $target -Value $txt -Encoding utf8
Write-Host "[OK] Inserted hasValidCoords() helper." -ForegroundColor Green
Write-Host "[NEXT] Run: npm run build" -ForegroundColor Cyan
