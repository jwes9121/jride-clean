# PATCH-DISPATCH-SHOW-ELIGIBLE-DRIVER-COUNTS-v2.ps1
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

# 1) Ensure counts exist right after eligibleDrivers is computed
if ($txt -notmatch '(?m)^\s*const\s+onlineCount\s*=') {
  $rxEligibleBlock = '(?ms)(const eligibleDrivers\s*=\s*\(drivers\s*\|\|\s*\[\]\)\.filter\([\s\S]*?\)\.sort\([\s\S]*?\);\s*)'
  $m = [regex]::Match($txt, $rxEligibleBlock)
  if (!$m.Success) {
    Fail "Could not locate eligibleDrivers computation block. Paste the Actions cell block around 'const eligibleDrivers = ...' if it was edited."
  }

  $insertCounts = @'
$1
    const onlineCount = (drivers || []).length;
    const busyCount = busy.size;
    const eligibleCount = eligibleDrivers.length;
'@
  $txt2 = [regex]::Replace($txt, $rxEligibleBlock, $insertCounts, 1)
  if ($txt2 -eq $txt) { Fail "Count insertion produced no change." }
  $txt = $txt2
  Write-Host "[OK] Inserted online/busy/eligible counts." -ForegroundColor Green
} else {
  Write-Host "[OK] Counts already present; skipping." -ForegroundColor Green
}

# 2) Insert indicator AFTER the driversError banner block (robust anchor)
if ($txt -notmatch 'Availability indicator \(pro dispatch UX\)') {

  $rxDriversErrorBlock = '(?ms)(\{driversError\s*\?\s*\(\s*<span[^>]*>\s*Drivers list unavailable \(manual UUID\)\s*</span>\s*\)\s*:\s*null\s*\}\s*)'
  $m2 = [regex]::Match($txt, $rxDriversErrorBlock)

  if (!$m2.Success) {
    Fail "Could not find the 'Drivers list unavailable (manual UUID)' banner block to anchor insertion. Search your page.tsx for that text and paste that block."
  }

  $indicator = @'
$1

        {/* Availability indicator (pro dispatch UX) */}
        {!alreadyAssigned && !pending && !isTerminal && !driversError ? (
          <span className="text-xs mr-2">
            <span className="font-mono">Online {onlineCount}</span>
            <span className="mx-1">/</span>
            <span className="font-mono">Busy {busyCount}</span>
            <span className="mx-1">/</span>
            <span className="font-mono">Eligible {eligibleCount}</span>
            {onlineCount > 0 && eligibleCount === 0 ? (
              <span className="ml-2 text-amber-700">0 eligible drivers (all online drivers are busy)</span>
            ) : null}
            {onlineCount === 0 ? (
              <span className="ml-2 text-amber-700">No online drivers</span>
            ) : null}
          </span>
        ) : null}

'@

  $txt2 = [regex]::Replace($txt, $rxDriversErrorBlock, $indicator, 1)
  if ($txt2 -eq $txt) { Fail "Indicator insertion produced no change." }
  $txt = $txt2
  Write-Host "[OK] Inserted availability indicator after driversError banner." -ForegroundColor Green

} else {
  Write-Host "[OK] Availability indicator already present; skipping." -ForegroundColor Green
}

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[OK] Wrote: $file" -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Open /dispatch -> rows should show Online/Busy/Eligible + clear message when Eligible=0" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback:" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
