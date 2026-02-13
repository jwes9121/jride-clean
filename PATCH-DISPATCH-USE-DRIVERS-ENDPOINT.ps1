# PATCH-DISPATCH-USE-DRIVERS-ENDPOINT.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw

# 1) Point refreshDrivers() to /api/dispatch/drivers
if ($txt -notmatch 'async function refreshDrivers\(\)') {
  Fail "Could not find refreshDrivers() in page.tsx."
}

# Replace the fetch URL inside refreshDrivers
$txt2 = $txt
$txt2 = $txt2 -replace 'fetch\("/api/admin/livetrips/page-data\?debug=1"', 'fetch("/api/dispatch/drivers")'
$txt2 = $txt2 -replace "fetch\('/api/admin/livetrips/page-data\?debug=1'\)", "fetch('/api/dispatch/drivers')"

if ($txt2 -eq $txt) {
  # Maybe URL already different; try a more general replacement of any fetch(...) inside refreshDrivers
  # We'll do a targeted block rewrite if needed.
  $rx = '(?ms)async function refreshDrivers\(\)\s*\{\s*try\s*\{\s*[\s\S]*?\}\s*catch\s*\([\s\S]*?\)\s*\{\s*[\s\S]*?\}\s*\}'
  $m = [regex]::Match($txt, $rx)
  if (!$m.Success) { Fail "Could not match refreshDrivers() block for rewrite." }

  $new = @'
async function refreshDrivers() {
  try {
    setDriversError(null);
    const res = await fetch("/api/dispatch/drivers", { cache: "no-store" as any });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || ("HTTP_" + res.status));
    }
    const j: any = await res.json().catch(() => ({}));
    const arr: any[] = Array.isArray(j?.drivers) ? j.drivers : [];
    const cleaned = (arr || []).filter((d) => !!getDriverId(d)).filter(isDriverOnline);
    setDrivers(cleaned);
  } catch (e: any) {
    setDrivers([]);
    setDriversError(e?.message || "DRIVERS_LOAD_FAILED");
  }
}
'@
  $txt2 = $txt.Remove($m.Index, $m.Length).Insert($m.Index, $new)
}

$txt = $txt2
Write-Host "[OK] refreshDrivers() now uses /api/dispatch/drivers" -ForegroundColor Green

# 2) Simplify parsing logic: our endpoint returns { ok, drivers }
# Remove references to livetrips page-data shapes if they exist (non-fatal)
# (This is optional; harmless if not present)
$txt = $txt -replace '(?ms)const candidates = \[[\s\S]*?\];\s*let arr: any\[\] = \[\];[\s\S]*?setDrivers\(cleaned\);', 'const cleaned = (arr || []).filter((d) => !!getDriverId(d)).filter(isDriverOnline); setDrivers(cleaned);'

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[OK] Wrote: $file" -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Open /dispatch -> you should now see dropdowns populated + Assign suggested enabled where eligible" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback:" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
