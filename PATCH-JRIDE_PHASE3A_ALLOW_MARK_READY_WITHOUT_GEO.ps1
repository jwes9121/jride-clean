$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$root = Get-Location
$path = Join-Path $root 'app\vendor-orders\page.tsx'
if (!(Test-Path $path)) { Fail "Missing app\vendor-orders\page.tsx (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $(Split-Path $bak -Leaf)"

$txt = Get-Content -LiteralPath $path -Raw

$pattern = 'disabled=\{vendorActionBlocked\s*\|\|\s*updatingId\s*===\s*o\.id\}'
if ($txt -notmatch $pattern) {
  Fail "Could not find Mark Ready disabled condition (vendorActionBlocked || updatingId === o.id)."
}

$txt2 = $txt -replace $pattern, 'disabled={updatingId === o.id}'

# UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt2, $utf8)

Ok "[OK] Phase 3A applied: Mark Ready no longer geo-blocked (preparing → driver_arrived)."
