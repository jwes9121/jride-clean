# RECOVER-DISPATCH-PAGE-TO-LAST-GOOD-v2.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "Missing: $file" }

# 0) Save current broken snapshot
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$broken = "$file.broken.$ts"
Copy-Item $file $broken -Force
Write-Host "[OK] Saved current broken snapshot -> $broken" -ForegroundColor Green

# 1) Collect backups (newest first)
$dir = Split-Path $file -Parent
$bakList = Get-ChildItem -Path $dir -Filter "page.tsx.bak.*" -File | Sort-Object LastWriteTime -Descending
if (!$bakList -or $bakList.Count -eq 0) { Fail "No backups found at: $dir\page.tsx.bak.*" }

Write-Host "[INFO] Backups found (newest first):" -ForegroundColor Cyan
$bakList | Select-Object -First 20 | ForEach-Object { Write-Host (" - " + $_.Name) }

# 2) Try restore each backup and run npm build until one passes
$good = $null
$logDir = Join-Path $root ".recover-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

foreach ($bak in $bakList) {
  Write-Host ""
  Write-Host "[TRY] Restoring $($bak.Name) -> page.tsx and testing build..." -ForegroundColor Yellow
  Copy-Item $bak.FullName $file -Force

  $log = Join-Path $logDir ("build-" + $bak.Name.Replace(':','_').Replace('\','_') + ".log")

  Push-Location $root
  try {
    # IMPORTANT: redirect inside cmd, not Start-Process, so 2>&1 is allowed
    $cmd = "npm run build > `"$log`" 2>&1"
    cmd.exe /c $cmd | Out-Null
    $exit = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if ($exit -eq 0) {
    Write-Host "[OK] Build PASSED with $($bak.Name)" -ForegroundColor Green
    $good = $bak.FullName
    break
  } else {
    Write-Host "[NO] Build failed with $($bak.Name). Log: $log" -ForegroundColor DarkYellow
  }
}

if (!$good) {
  Write-Host ""
  Write-Host "[FAIL] No backup produced a successful build." -ForegroundColor Red
  Write-Host "Current broken snapshot preserved at: $broken" -ForegroundColor Red
  Write-Host "Logs are in: $logDir" -ForegroundColor Red
  Fail "Recovery failed: no build-passing backup found."
}

Write-Host ""
Write-Host "[DONE] Restored build-passing dispatch page from:" -ForegroundColor Green
Write-Host "  $good" -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Open http://localhost:3000/dispatch" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback to the broken snapshot:" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $broken + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
