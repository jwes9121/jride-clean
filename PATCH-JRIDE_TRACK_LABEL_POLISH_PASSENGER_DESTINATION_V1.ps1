# PATCH-JRIDE_TRACK_LABEL_POLISH_PASSENGER_DESTINATION_V1.ps1
# UI-only label polish (PS5-safe). No logic changes.
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$root = (Get-Location).Path
if (!(Test-Path (Join-Path $root "package.json"))) {
  Fail "Run this from your Next.js repo root (where package.json exists)."
}

$trackClient = Join-Path $root "app\ride\track\TrackClient.tsx"
if (!(Test-Path $trackClient)) { Fail "Missing: $trackClient" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("TrackClient.tsx.bak.{0}" -f $ts)
Copy-Item -Force $trackClient $bak
Ok "[OK] Backup: $bak"

$src = Get-Content -Raw -Path $trackClient

# Ensure the patch area exists (smartNavLabel function should exist from prior patch)
if ($src -notmatch 'function smartNavLabel\(\)') {
  Fail "Anchor missing: function smartNavLabel(). TrackClient.tsx not in expected state."
}

# Replace labels (only text)
$src2 = $src
$src2 = $src2 -replace 'Navigate to Pickup', 'Navigate to Passenger'
$src2 = $src2 -replace 'Navigate to Dropoff', 'Navigate to Destination'

if ($src2 -eq $src) {
  Warn "[WARN] No label changes applied (strings not found). File may already be polished or differs."
} else {
  WriteUtf8NoBom $trackClient $src2
  Ok "[OK] Patched labels in: app/ride/track/TrackClient.tsx"
}

Ok "=== DONE: Track labels polished (Passenger / Destination) ==="
Ok "[NEXT] Refresh: http://localhost:3000/ride/track?code=JR-UI-20260209183602-7306"
