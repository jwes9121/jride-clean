# PATCH-JRIDE_BACKEND_ACTIVE_TRIP_REMOVE_DEBUG_LOGS_V2.ps1
# Removes temporary ACTIVE_TRIP_DEBUG console logs from:
#   app/api/driver/active-trip/route.ts
# Creates a backup and removes any line containing "[ACTIVE_TRIP_DEBUG]"

$ErrorActionPreference = "Stop"

function Read-Utf8NoBom([string]$path) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  return [System.IO.File]::ReadAllText($path, $enc)
}
function Write-Utf8NoBom([string]$path, [string]$content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

$root   = (Get-Location).Path
$target = Join-Path $root "app\api\driver\active-trip\route.ts"

if (!(Test-Path $target)) { throw "Missing file: $target" }

$backupDir = Join-Path $root "_patch_backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("app__api__driver__active-trip__route.ts.bak.$stamp")
Copy-Item -Force $target $backup
Write-Host "[OK] Backup: $backup" -ForegroundColor Green

$txt = Read-Utf8NoBom $target

$lines = $txt -split "`r?`n"
$newLines = New-Object System.Collections.Generic.List[string]
$removed = 0

foreach ($line in $lines) {
  if ($line -match "\[ACTIVE_TRIP_DEBUG\]") {
    $removed++
    continue
  }
  $newLines.Add($line) | Out-Null
}

if ($removed -eq 0) {
  Write-Host "[OK] No ACTIVE_TRIP_DEBUG lines found. No changes applied." -ForegroundColor Green
  exit 0
}

$out = ($newLines -join "`r`n")
Write-Utf8NoBom $target $out
Write-Host "[DONE] Removed $removed debug log line(s) from: $target" -ForegroundColor Green
