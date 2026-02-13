# FIX-JRIDE_LIVETRIPS_BROKEN_ISAVAIL_LINE_V1.ps1
# Repairs malformed `const isAvail = ...` line introduced by prior patch.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw -Encoding UTF8
$orig = $txt

# Replace the whole const isAvail line if it's malformed (contains "};return" or otherwise broken)
$pattern = '(?m)^\s*const\s+isAvail\s*=\s*\(d:\s*any\)\s*=>.*$'
$fixedLine = '    const isAvail = (d: any) => { const s = String(d?.status ?? "").trim().toLowerCase(); return (s === "available" || s === "online" || s === "idle"); };'

# We ONLY apply if we detect the broken marker near it (safer)
if ($txt -notmatch 'const\s+isAvail\s*=\s*\(d:\s*any\)\s*=>.*};return') {
  Fail "Did not detect the specific broken 'isAvail' line (no '};return' found). Paste the exact isAvail line if it changed."
}

$txt = [regex]::Replace($txt, $pattern, $fixedLine, [System.Text.RegularExpressions.RegexOptions]::Multiline)

if ($txt -eq $orig) {
  Fail "No changes applied (unexpected)."
}

Set-Content -Path $target -Value $txt -Encoding UTF8
Write-Host "[OK] Repaired isAvail line in: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
