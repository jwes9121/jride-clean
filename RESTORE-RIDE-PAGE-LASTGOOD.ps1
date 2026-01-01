# RESTORE-RIDE-PAGE-LASTGOOD.ps1
# Restores app\ride\page.tsx from the newest .bak.* backup.
# PowerShell 5 safe, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$target = Join-Path (Get-Location) "app\ride\page.tsx"
if (-not (Test-Path $target)) { Fail "Not found: $target" }

$dir = Split-Path $target -Parent
$base = Split-Path $target -Leaf

$backs = Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like ($base + ".bak.*") } |
  Sort-Object LastWriteTime -Descending

if (-not $backs -or $backs.Count -eq 0) {
  Fail "No backups found matching: $($base).bak.* in $dir"
}

$pick = $backs[0].FullName
Info "Restoring from: $pick"
Copy-Item -LiteralPath $pick -Destination $target -Force
Ok "Restored: $target"
Ok "Done."
