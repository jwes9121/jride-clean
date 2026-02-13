$ErrorActionPreference = "Stop"

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$path = Join-Path $root "app\api\dispatch\status\route.ts"
if (-not (Test-Path $path)) { throw "File not found: $path" }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$path.bak-fixif-$ts"
Copy-Item $path $bak -Force
Write-Host "Backup: $bak" -ForegroundColor Yellow

$s = Get-Content $path -Raw

# Fix the broken block that starts with "(" instead of "if ("
# Handles multiline formatting.
$pattern = '(?ms)^[ \t]*\(\s*toStatus\s*===\s*"(?:completed|cancelled)"\s*\|\|\s*toStatus\s*===\s*"(?:completed|cancelled)"\s*\)\s*\{'
if ($s -match $pattern) {
  $s = [regex]::Replace($s, $pattern, 'if (toStatus === "completed" || toStatus === "cancelled") {', 1)
  Set-Content -Path $path -Value $s -Encoding UTF8
  Write-Host "OK: Patched missing 'if' for completed/cancelled clear-block." -ForegroundColor Green
  exit 0
}

# Wider fallback: any standalone "(toStatus ... completed ... cancelled ...) {" line/block
$pattern2 = '(?ms)^[ \t]*\(\s*[^;{]{0,250}toStatus[^;{]{0,250}completed[^;{]{0,250}cancelled[^;{]{0,250}\)\s*\{'
if ($s -match $pattern2) {
  $s = [regex]::Replace($s, $pattern2, 'if (toStatus === "completed" || toStatus === "cancelled") {', 1)
  Set-Content -Path $path -Value $s -Encoding UTF8
  Write-Host "OK: Patched missing 'if' (fallback matcher)." -ForegroundColor Green
  exit 0
}

throw "Could not find the broken '(toStatus...completed...cancelled...) {' block. Open $path and search for 'toStatus' near the top."
