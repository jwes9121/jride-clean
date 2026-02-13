# PATCH-JRIDE_REMOVE_BOOKINGS_VEHICLE_TYPE_BACKEND_V1.ps1
# Purpose:
# - Remove bookings.vehicle_type from backend selects/inserts so driver status actions don't crash
# - PS5-safe, makes backups

$ErrorActionPreference = "Stop"

$repoRoot = (Get-Location).Path
$bakDir = Join-Path $repoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

function Backup-File([string]$path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [IO.Path]::GetFileName($path)
  $dest = Join-Path $bakDir ($name + ".bak." + $ts)
  Copy-Item -LiteralPath $path -Destination $dest -Force
  Write-Host "[OK] Backup: $dest"
}

function Read-Text([string]$path) {
  return Get-Content -LiteralPath $path -Raw -ErrorAction Stop
}

function Write-Text([string]$path, [string]$content) {
  $content | Out-File -LiteralPath $path -Encoding UTF8
  Write-Host "[OK] Patched: $path"
}

function Replace-OrThrow([string]$label, [string]$content, [string]$pattern, [string]$replacement) {
  $rx = [regex]::new($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (!$rx.IsMatch($content)) { throw "Patch anchor not found for: $label" }
  return $rx.Replace($content, $replacement, 1)
}

# -------- Targets (from your scan report) --------
$statusRoute = Join-Path $repoRoot "app\api\dispatch\status\route.ts"
$ridesCreate = Join-Path $repoRoot "app\api\rides\create\route.ts"

Write-Host "== JRIDE Patch: Remove bookings.vehicle_type usage (Backend V1) =="

# ---------- Patch: status route ----------
Backup-File $statusRoute
$txt = Read-Text $statusRoute

# 1) Remove vehicle_type from select list that includes "town, vehicle_type, verified_fare"
# Handles variants with spaces
$txt = $txt -replace 'town\s*,\s*vehicle_type\s*,\s*verified_fare', 'town, verified_fare'

# 2) Remove vehicle_type from select list where it might appear without spaces "town,vehicle_type,verified_fare"
$txt = $txt -replace 'town\s*,\s*vehicle_type\s*,\s*verified_fare', 'town, verified_fare'

# 3) Safety: remove any remaining ", vehicle_type" inside select("...") strings (conservative)
# (does NOT touch TS types, only literal select strings that include vehicle_type)
$txt = $txt -replace '(select\(\s*["''][^"'']*)\s*,\s*vehicle_type(\s*[,][^"'']*["'']\s*\))', '${1}${2}'

Write-Text $statusRoute $txt

# ---------- Patch: rides/create route ----------
Backup-File $ridesCreate
$txt2 = Read-Text $ridesCreate

# A) Remove vehicle_type from req.json destructure default
# from: const { pickup_lat, pickup_lng, town = "Lagawe", vehicle_type = "tricycle" } = await req.json();
# to:   const { pickup_lat, pickup_lng, town = "Lagawe" } = await req.json();
$txt2 = $txt2 -replace 'const\s*\{\s*pickup_lat\s*,\s*pickup_lng\s*,\s*town\s*=\s*"Lagawe"\s*,\s*vehicle_type\s*=\s*"tricycle"\s*\}\s*=\s*await\s*req\.json\(\)\s*;',
'const { pickup_lat, pickup_lng, town = "Lagawe" } = await req.json();'

# B) Remove vehicle_type from insert payload
# from: .insert({ pickup_lat, pickup_lng, town, vehicle_type, status: "pending" })
# to:   .insert({ pickup_lat, pickup_lng, town, status: "pending" })
$txt2 = $txt2 -replace '\.insert\(\s*\{\s*pickup_lat\s*,\s*pickup_lng\s*,\s*town\s*,\s*vehicle_type\s*,\s*status:\s*"pending"\s*\}\s*\)',
'.insert({ pickup_lat, pickup_lng, town, status: "pending" })'

Write-Text $ridesCreate $txt2

Write-Host ""
Write-Host "[DONE] Backend no longer requires bookings.vehicle_type."
Write-Host "Next: redeploy and re-test driver Accept/On the way/Start/Complete."
