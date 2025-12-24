# PATCH-DISPATCH-FIX-ROW-SCOPE-GENERIC.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "Missing: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw

# 1) Find the injected IIFE block that currently references `row.driver_id`
# We match an IIFE that contains "const didCurrent = row.driver_id"
$rxIife = '(?ms)\{\s*\(\(\)\s*=>\s*\{\s*([\s\S]*?const\s+didCurrent\s*=\s*row\.driver_id[\s\S]*?)\}\)\(\)\s*\}'
$m = [regex]::Match($txt, $rxIife)

if (!$m.Success) {
  Fail "Could not find the injected IIFE containing 'const didCurrent = row.driver_id'. Search page.tsx for 'didCurrent = row.driver_id' to confirm it exists."
}

$body = $m.Groups[1].Value

# 2) Replace the first occurrence of `const didCurrent = row.driver_id ...` with a safe `_row` resolver + didCurrent
$rxDid = '(?m)^\s*const\s+didCurrent\s*=\s*row\.driver_id\s*\|\|\s*["'']["'']\s*;\s*$'
if (-not [regex]::IsMatch($body, $rxDid)) {
  Fail "Found the IIFE, but could not find the exact didCurrent line to patch."
}

$body = [regex]::Replace($body, $rxDid, @'
    const _row =
      (typeof row !== "undefined" ? row :
        (typeof r !== "undefined" ? r :
          (typeof item !== "undefined" ? item :
            (typeof booking !== "undefined" ? booking : null))));
    if (!_row) return null;

    const didCurrent = _row.driver_id || "";
'@, 1)

# 3) Inside this IIFE body only, replace row.* usages with _row.* (but keep typeof row safe resolver untouched)
# We only replace "row." occurrences now that _row is defined.
$body = $body -replace '\brow\.', '_row.'

# Rebuild the IIFE
$newIife = "{(() => {`r`n$body`r`n})()}"

$txt2 = $txt.Remove($m.Index, $m.Length).Insert($m.Index, $newIife)
if ($txt2 -eq $txt) { Fail "Patch produced no change (unexpected)." }

Set-Content -Path $file -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched IIFE: resolved row variable safely via _row (fixes 'row is not defined')." -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Open http://localhost:3000/dispatch (runtime error should be gone)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback:" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
