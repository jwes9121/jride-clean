$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\admin\driver_locations\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw

# Replace bad relative import to a correct one.
# Try alias first; if you don't use alias, swap the replacement to ../../../../lib/supabaseAdmin
$txt2 = $txt

# Common wrong path:
$txt2 = $txt2 -replace "(from\s+['""])\.\.\/\.\.\/\.\.\/lib\/supabaseAdmin(['""]\s*;)", "`$1@/lib/supabaseAdmin`$2"
$txt2 = $txt2 -replace "(from\s+['""])\.\.\/\.\.\/\.\.\/lib\/supabaseAdmin(['""]\s*)", "`$1@/lib/supabaseAdmin`$2"

# If it was already close but still wrong:
$txt2 = $txt2 -replace "(from\s+['""])\.\.\/\.\.\/\.\.\/\.\.\/lib\/supabaseAdmin(['""]\s*)", "`$1@/lib/supabaseAdmin`$2"

if ($txt2 -eq $txt) {
  Write-Host "[WARN] No import replacement matched. Opening file to help you spot it:"
  Write-Host "----- FIRST 80 LINES -----"
  ($txt -split "`n" | Select-Object -First 80) -join "`n" | Write-Host
  Write-Host "--------------------------"
  Fail "No changes applied. Search inside route.ts for supabaseAdmin import and adjust manually."
}

Set-Content -Path $target -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "=== Build ==="
& npm.cmd run build

Write-Host ""
Write-Host "=== DONE ==="
