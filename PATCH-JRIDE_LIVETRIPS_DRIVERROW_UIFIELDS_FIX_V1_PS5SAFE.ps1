param(
  [string]$RepoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE LIVETRIPS DRIVERROW UI FIELDS FIX =="

$file = Join-Path $RepoRoot "app\admin\livetrips\LiveTripsClient.tsx"

if (!(Test-Path $file)) {
    throw "LiveTripsClient.tsx not found"
}

$backupDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("LiveTripsClient.tsx.bak.DRIVERROW_UIFIELDS_FIX." + $timestamp)

Copy-Item $file $backup
Write-Host "[OK] Backup created: $backup"

$content = Get-Content $file -Raw

# ----------------------------------------------------
# Find DriverRow type definition
# ----------------------------------------------------

$pattern = "type\s+DriverRow\s*=\s*{[^}]*}"

$match = [regex]::Match($content, $pattern, "Singleline")

if (!$match.Success) {
    throw "DriverRow type definition not found"
}

$newType = @"
type DriverRow = {
  driver_id: string
  lat?: number
  lng?: number
  status?: string
  updated_at?: string

  age_seconds?: number
  assign_eligible?: boolean
  is_stale?: boolean

  name?: string
  phone?: string
  town?: string
}
"@

$content = $content.Replace($match.Value, $newType)

# ----------------------------------------------------
# Save ASCII safe
# ----------------------------------------------------

[System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::ASCII)

Write-Host "[OK] DriverRow interface updated with UI fields"
Write-Host "Patch complete."