param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function New-Timestamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$ts = New-Timestamp

Write-Host "== JRIDE Zip: Assign triage 3 files (V1 / PS5-safe) =="
Write-Host "Repo: $proj"

$assignPath = Join-Path $proj "app\api\dispatch\assign\route.ts"
if (-not (Test-Path -LiteralPath $assignPath)) {
  throw "Missing required file: $assignPath"
}

# Find passenger booking route by marker text "BOOKED_OK"
$bookCandidates = Get-ChildItem -LiteralPath (Join-Path $proj "app") -Recurse -File -Filter "route.ts" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match "\\app\\api\\" } |
  ForEach-Object {
    $p = $_.FullName
    try {
      $t = Get-Content -LiteralPath $p -Raw -ErrorAction Stop
      if ($t -match "BOOKED_OK") { return $p }
    } catch {}
  } | Select-Object -First 1

# Find route (or other TS/TSX) that calls /api/dispatch/assign
$callCandidates = Get-ChildItem -LiteralPath (Join-Path $proj "app") -Recurse -File -Include "*.ts","*.tsx" -ErrorAction SilentlyContinue |
  ForEach-Object {
    $p = $_.FullName
    try {
      $t = Get-Content -LiteralPath $p -Raw -ErrorAction Stop
      if ($t -match "/api/dispatch/assign") { return $p }
    } catch {}
  } | Select-Object -First 1

if (-not $bookCandidates) {
  Write-Warning "Could not auto-find booking route via 'BOOKED_OK'. We'll still zip assign route + caller file(s) if found."
}
if (-not $callCandidates) {
  Write-Warning "Could not auto-find a file that calls '/api/dispatch/assign'."
}

# Build exactly 3 files:
# 1) assign route
# 2) booking route if found, else fallback to caller if found
# 3) caller file if found and not duplicate, else a useful fallback (livetrips page-data route if exists)
$files = New-Object System.Collections.Generic.List[string]
$files.Add($assignPath)

if ($bookCandidates) { $files.Add($bookCandidates) }

if ($callCandidates -and ($files -notcontains $callCandidates)) {
  $files.Add($callCandidates)
}

# If we still have <3, add a useful fallback
$fallback = Join-Path $proj "app\api\admin\livetrips\page-data\route.ts"
if ($files.Count -lt 3 -and (Test-Path -LiteralPath $fallback)) {
  if ($files -notcontains $fallback) { $files.Add($fallback) }
}

# If we still have <3, add the passenger ride page component if exists
$fallback2 = Join-Path $proj "app\ride\page.tsx"
if ($files.Count -lt 3 -and (Test-Path -LiteralPath $fallback2)) {
  if ($files -notcontains $fallback2) { $files.Add($fallback2) }
}

# Enforce exactly 3 by trimming extras
while ($files.Count -gt 3) { $files.RemoveAt($files.Count - 1) }

if ($files.Count -ne 3) {
  Write-Host ""
  Write-Host "Files found so far:" -ForegroundColor Yellow
  $files | ForEach-Object { Write-Host " - $_" }
  throw "Could not resolve exactly 3 files to zip. (Found $($files.Count)). Tell me your passenger booking route path and I'll hardcode it."
}

# Create staging folder
$outDir = Join-Path $proj ("_diag_out_$ts")
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$stageDir = Join-Path $outDir "assign_triage_3files"
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

# Copy files preserving relative-ish names
for ($i=0; $i -lt $files.Count; $i++) {
  $src = $files[$i]
  $rel = $src.Substring($proj.Length).TrimStart('\')
  $dest = Join-Path $stageDir ($rel -replace "[:]", "_")
  $destParent = Split-Path -Parent $dest
  New-Item -ItemType Directory -Path $destParent -Force | Out-Null
  Copy-Item -LiteralPath $src -Destination $dest -Force
}

# Add manifest
$manifest = Join-Path $stageDir "_MANIFEST.txt"
@(
  "JRIDE assign triage bundle",
  "Timestamp: $ts",
  "",
  "Included files:"
) + ($files | ForEach-Object { " - " + $_ }) | Set-Content -LiteralPath $manifest -Encoding utf8

# Zip
$zipPath = Join-Path $outDir ("JRIDE_ASSIGN_TRIAGE_3FILES_$ts.zip")
Compress-Archive -LiteralPath (Join-Path $stageDir "*") -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "[OK] Created zip:" -ForegroundColor Green
Write-Host "  $zipPath"
Write-Host ""
Write-Host "Included:" -ForegroundColor Cyan
$files | ForEach-Object { Write-Host " - $_" }