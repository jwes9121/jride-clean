# RESTORE-DISPATCH-PAGE-LATEST-BACKUP.ps1
# Restores app/dispatch/page.tsx from the most recent page.tsx.bak.* backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$dir = "app\dispatch"
$target = Join-Path $dir "page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = Get-ChildItem -File -Path $dir -Filter "page.tsx.bak.*" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (!$bak) { Fail "No backups found: $dir\page.tsx.bak.*" }

Copy-Item $bak.FullName $target -Force
Write-Host "[OK] Restored $target from $($bak.Name)" -ForegroundColor Green
