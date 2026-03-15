param(
  [string]$RepoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE LIVETRIPS ASCII FORCE CLEAN =="

$file = Join-Path $RepoRoot "app\admin\livetrips\LiveTripsClient.tsx"

if (!(Test-Path $file)) {
    throw "LiveTripsClient.tsx not found: $file"
}

$backupDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("LiveTripsClient.tsx.bak.ASCII_FORCE_CLEAN." + $timestamp)

Copy-Item $file $backup

Write-Host "[OK] Backup created:" $backup

# Read raw bytes
$bytes = [System.IO.File]::ReadAllBytes($file)

# Keep only ASCII bytes (0-127)
$asciiBytes = New-Object System.Collections.Generic.List[byte]

foreach ($b in $bytes) {
    if ($b -le 127) {
        $asciiBytes.Add($b)
    }
}

# Rewrite file
[System.IO.File]::WriteAllBytes($file, $asciiBytes.ToArray())

Write-Host "[OK] File rewritten with ASCII-only bytes"
Write-Host "Patch complete."