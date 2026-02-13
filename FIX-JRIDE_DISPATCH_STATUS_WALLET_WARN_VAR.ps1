# FIX-JRIDE_DISPATCH_STATUS_WALLET_WARN_VAR.ps1
# One file only: app\api\dispatch\status\route.ts
# PowerShell 5, ASCII only.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$root = Get-Location
$rel  = "app\api\dispatch\status\route.ts"
$path = Join-Path $root $rel

if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $path

# If warn already exists, do nothing.
if ($txt -like "*const warn =*") {
  Info "const warn already present. No change."
  exit 0
}

# Insert const warn right before const mergedWarn (inside POST success return path)
$needle = "const mergedWarn ="
$pos = $txt.IndexOf($needle)
if ($pos -lt 0) { Fail "Could not find '$needle' in route.ts" }

$warnBlock = @'
  const warn =
    drv.warning
      ? (audit.warning ? (String(drv.warning) + "; " + String(audit.warning)) : String(drv.warning))
      : (audit.warning ? String(audit.warning) : null);

'@

$txt = $txt.Insert($pos, $warnBlock)
Ok "Inserted const warn before const mergedWarn."

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Info "Done."
