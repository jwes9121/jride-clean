# PATCH-JRIDE_DRIVER_ACTIVE_TRIP_ENDPOINT_V4B.ps1
# Fix: DB_ERROR column bookings.pickup_label does not exist
# Patches: app/api/driver/active-trip/route.ts
# Replaces first .select("...") / .select('...') with safe columns only.

$ErrorActionPreference = "Stop"

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$path = Join-Path $repo "app\api\driver\active-trip\route.ts"

if (!(Test-Path $path)) { throw "File not found: $path" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -Raw -Path $path

# Match: .select("....") OR .select('....')
# PowerShell-safe quoting: inside single-quoted string, represent literal ' as ''.
$pattern = '\.select\(\s*(["''])([\s\S]*?)\1\s*\)'

if ($txt -notmatch $pattern) {
  throw "Anchor not found: .select('...') or .select(""..."") in $path"
}

# Known-safe columns from your DB screenshots (do NOT include pickup_label/dropoff_label)
$replacement = '.select("id, created_at, town, status, assigned_driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng")'

$txt2 = [System.Text.RegularExpressions.Regex]::Replace($txt, $pattern, $replacement, 1)

# Extra safety: remove any lingering tokens if they existed elsewhere
$txt2 = $txt2 -replace '\bpickup_label\b', ''
$txt2 = $txt2 -replace '\bdropoff_label\b', ''

# Write UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt2, $utf8NoBom)

Write-Host "[OK] Patched .select(...) to match actual bookings schema."
Write-Host "[NEXT] Run build, then re-test the endpoint."
