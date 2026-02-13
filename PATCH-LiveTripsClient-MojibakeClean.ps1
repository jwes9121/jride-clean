$ErrorActionPreference = "Stop"

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"

if (!(Test-Path $file)) { throw "Missing: $file" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $root ("backups\LiveTripsClient_MOJIBAKE_CLEAN_" + $stamp + ".tsx")
Copy-Item $file $bak -Force
Write-Host "[OK] Backup created: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw -Encoding UTF8

# Ensure safeText exists (if not, insert after "use client";)
if ($txt -notmatch "function safeText") {
  $needle = '"use client";'
  $pos = $txt.IndexOf($needle)
  if ($pos -lt 0) { throw 'Could not find "use client";' }

  $helper = @"
function safeText(v: any) {
  if (v == null) return "-";
  const s = String(v);
  return s.replace(/[^\x00-\x7F]/g, "-");
}

"@
  $insertAt = $pos + $needle.Length
  $txt = $txt.Substring(0, $insertAt) + "`r`n`r`n" + $helper + $txt.Substring($insertAt)
  Write-Host "[OK] Inserted safeText()" -ForegroundColor Green
} else {
  Write-Host "[OK] safeText() already present" -ForegroundColor Green
}

# 1) Clean Unicode punctuation in source (ASCII normalize)
$txt = $txt.Replace("—", "-").Replace("–", "-").Replace("…", "...")

# 2) Remove mojibake marker letters from the TSX source itself (these should never be there)
# NOTE: this is safe in code because valid TSX should not contain these characters at all.
$txt = $txt.Replace("Ã", "").Replace("", "").Replace("â", "")

# 3) If driver dropdown renders something like {d.name} or {driver.name}, wrap with safeText where possible (literal replacements only)
$txt = $txt.Replace("{d.name}", "{safeText(d.name)}")
$txt = $txt.Replace("{driver.name}", "{safeText(driver.name)}")
$txt = $txt.Replace("{drv.name}", "{safeText(drv.name)}")

# 4) Also clean any common static UI labels that might be rendering raw (literal replacements)
$txt = $txt.Replace("stuck watcher thresholds", "stuck watcher thresholds") # no-op, just anchor

# Write UTF-8 (no BOM)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($file, $txt, $utf8)

Write-Host "[OK] LiveTripsClient mojibake cleanup applied." -ForegroundColor Green
Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "1) Ctrl+C (stop dev server)"
Write-Host "2) Remove-Item .next -Recurse -Force"
Write-Host "3) npm run dev"
Write-Host "4) Ctrl+Shift+R (hard refresh)"
