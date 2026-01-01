# ROLLBACK-RIDE-PAGE-TO-LAST-GREEN.ps1
# Tries app\ride\page.tsx backups newest->oldest until "npm run build" succeeds.
# Restores the first backup that builds.
# ASCII only. PowerShell 5 compatible.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$target = Join-Path (Get-Location) "app\ride\page.tsx"
if (-not (Test-Path $target)) { Fail "Not found: $target" }

$dir = Split-Path $target -Parent
$base = Split-Path $target -Leaf

$backs = Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like ($base + ".bak.*") } |
  Sort-Object LastWriteTime -Descending

if (-not $backs -or $backs.Count -eq 0) {
  Fail "No backups found for $base (expected $base.bak.*) in $dir"
}

Info ("Found backups: " + $backs.Count)

# Keep a safety backup of current broken file
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$curBak = "$target.broken.bak.$stamp"
Copy-Item -LiteralPath $target -Destination $curBak -Force
Ok "Saved current file: $curBak"

$success = $false
$used = $null

foreach ($b in $backs) {
  Info ("Trying backup: " + $b.FullName)
  Copy-Item -LiteralPath $b.FullName -Destination $target -Force

  # Run build
  & powershell -NoProfile -ExecutionPolicy Bypass -Command "npm run build" | Out-Host
  if ($LASTEXITCODE -eq 0) {
    $success = $true
    $used = $b.FullName
    Ok "BUILD OK with: $used"
    break
  } else {
    Warn "Build failed with this backup. Trying older..."
  }
}

if (-not $success) {
  # Restore original broken file so nothing is lost
  Copy-Item -LiteralPath $curBak -Destination $target -Force
  Fail "No backup produced a successful build. Restored original broken file. Upload app/ride/page.tsx for a precise repair."
}

Ok "Ride page rolled back to last green backup."
Ok ("Using: " + $used)
Ok "Done."
