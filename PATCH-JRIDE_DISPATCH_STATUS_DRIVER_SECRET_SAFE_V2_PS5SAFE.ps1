param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

Write-Host "== SAFE PATCH: dispatch/status allow driver secret (V2) =="

$target = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.bak.DISPATCH_STATUS_DRIVER_SECRET_SAFE_V2.$ts")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

if ($txt -match "x-driver-ping-secret") {
  Write-Host "[WARN] driver secret already appears present. Skipping."
  exit 0
}

# Replace only the auth gate condition safely
$pattern = 'if\s*\(!allowUnauth\s*&&\s*!\(wantSecret\s*&&\s*gotSecret\s*&&\s*gotSecret\s*===\s*wantSecret\)\)\s*\{'

$replacement = @'
const driverSecret = String(req.headers.get("x-driver-ping-secret") || "").trim();
const wantDriverSecret = String(process.env.DRIVER_PING_SECRET || process.env.DRIVER_API_SECRET || "").trim();
const driverSecretOk = !!(wantDriverSecret && driverSecret === wantDriverSecret);

if (!allowUnauth && !(driverSecretOk || (wantSecret && gotSecret && gotSecret === wantSecret))) {
'@

$newTxt = [regex]::Replace($txt, $pattern, $replacement, 1)

if ($newTxt -eq $txt) {
  throw "Auth gate pattern not found. File structure may differ."
}

Set-Content -LiteralPath $target -Value $newTxt -Encoding UTF8
Write-Host "[OK] Patched auth gate safely."
Write-Host "Done."