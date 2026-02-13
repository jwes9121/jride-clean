# PATCH-JRIDE_BACKEND_ACTIVE_TRIP_INCLUDE_ACCEPTED_V1.ps1
# Ensures /app/api/driver/active-trip/route.ts considers "accepted" as active
$ErrorActionPreference = "Stop"

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$target = Join-Path $root "app\api\driver\active-trip\route.ts"
if (!(Test-Path $target)) { throw "Missing: $target" }

# Backup
$bakDir = Join-Path $root "_patch_backups"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("app__api__driver__active-trip__route.ts.bak.$stamp")
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

# Read bytes -> strip BOM if present -> decode as UTF8
$bytes = [System.IO.File]::ReadAllBytes($target)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  $bytes = $bytes[3..($bytes.Length-1)]
}
$txt = [System.Text.Encoding]::UTF8.GetString($bytes)

# Try to find a status list and ensure "accepted" is in it.
# Common patterns we handle:
#  - const ACTIVE_STATUSES = ["assigned", "on_the_way", ...]
#  - .in("status", ["assigned", ...])
#  - .or("status.eq.assigned,status.eq.on_the_way,...")
$before = $txt

# 1) Array list case
$txt = [regex]::Replace($txt,
  '(?s)(ACTIVE_STATUSES\s*=\s*\[)([^\]]*)(\])',
  {
    param($m)
    $head = $m.Groups[1].Value
    $mid  = $m.Groups[2].Value
    $tail = $m.Groups[3].Value
    if ($mid -match '"accepted"' -or $mid -match "'accepted'") { return $m.Value }
    return $head + ($mid.TrimEnd() + (if ($mid.Trim().Length -gt 0) { ", " } else { "" }) + '"accepted"') + $tail
  }
)

# 2) .in("status", [ ... ]) case
$txt = [regex]::Replace($txt,
  '(?s)\.in\(\s*["'']status["'']\s*,\s*\[([^\]]*)\]\s*\)',
  {
    param($m)
    $inner = $m.Groups[1].Value
    if ($inner -match '"accepted"' -or $inner -match "'accepted'") { return $m.Value }
    $newInner = $inner.TrimEnd() + (if ($inner.Trim().Length -gt 0) { ", " } else { "" }) + '"accepted"'
    return $m.Value -replace [regex]::Escape($inner), [regex]::Escape($newInner)
  }
)

# 3) .or("status.eq.assigned,...") case
$txt = [regex]::Replace($txt,
  '(\.or\(\s*["''])([^"''\)]*)(["'']\s*\))',
  {
    param($m)
    $a = $m.Groups[1].Value
    $s = $m.Groups[2].Value
    $b = $m.Groups[3].Value
    if ($s -match 'status\.eq\.accepted') { return $m.Value }
    # append accepted in the OR chain
    $sep = if ($s.Trim().EndsWith(",")) { "" } else { "," }
    return $a + ($s + $sep + "status.eq.accepted") + $b
  }
)

if ($txt -eq $before) {
  throw "No changes applied. Could not find an ACTIVE statuses filter in $target. Paste the file content (or upload it) and I'll patch exact anchors."
}

# Write UTF8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)
Write-Host "[OK] Patched: $target" -ForegroundColor Green

Write-Host "`nNEXT:" -ForegroundColor Cyan
Write-Host "  npm.cmd run build" -ForegroundColor Cyan
