param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$target = Join-Path $ProjRoot "app\api\admin\livetrips\page-data\route.ts"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Target not found: $target" }

Info "== FIX: TDZ error (ACTIVE_STATUSES used before declaration) V1 / PS5-safe =="
Info "Target: $target"

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("livetrips-page-data.route.ts.bak.TDZ_FIX_V1.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# Hardcode the active statuses in the bypass debug block to avoid TDZ
# Replace the first occurrence in the bypass block:
# injected_active_statuses: ACTIVE_STATUSES,
$literal = 'injected_active_statuses: ["requested","pending","ready","assigned","on_the_way","arrived","enroute","on_trip"],'

$re = New-Object System.Text.RegularExpressions.Regex('injected_active_statuses\s*:\s*ACTIVE_STATUSES\s*,', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $re.IsMatch($src)) {
  Fail "[FAIL] Could not find 'injected_active_statuses: ACTIVE_STATUSES,' to replace."
}

$src = $re.Replace($src, $literal, 1)
Ok "[OK] Replaced injected_active_statuses: ACTIVE_STATUSES with literal array (first occurrence)"

# Write back UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $src, $utf8NoBom)
Ok "[OK] Wrote patched file (UTF-8 no BOM)"
