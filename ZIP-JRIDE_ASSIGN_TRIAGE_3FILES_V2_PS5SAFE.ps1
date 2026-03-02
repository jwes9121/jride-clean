param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function New-Timestamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }
function Is-IgnoredPath([string]$p) {
  $lp = $p.ToLowerInvariant()
  return (
    $lp -like "*\_backup_archive\*" -or
    $lp -like "*\backups\*" -or
    $lp -like "*\_patch_bak\*" -or
    $lp -like "*\.bak*" -or
    $lp -like "*\node_modules\*" -or
    $lp -like "*\.next\*"
  )
}

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$ts = New-Timestamp

Write-Host "== JRIDE Zip: Assign triage 3 files (V2 / PS5-safe) =="
Write-Host "Repo: $proj"

$assignPath = Join-Path $proj "app\api\dispatch\assign\route.ts"
if (-not (Test-Path -LiteralPath $assignPath)) {
  throw "Missing required file: $assignPath"
}

# Search space: app/ only, excluding backup folders and *.bak*
$allFiles = Get-ChildItem -LiteralPath (Join-Path $proj "app") -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { -not (Is-IgnoredPath $_.FullName) } |
  Select-Object -ExpandProperty FullName

function Find-FirstContaining([string]$pattern) {
  foreach ($p in $allFiles) {
    try {
      $t = Get-Content -LiteralPath $p -Raw -ErrorAction Stop
      if ($t -match $pattern) { return $p }
    } catch {}
  }
  return $null
}

# 1) booking UI/API marker
$bookMarkerFile = Find-FirstContaining "BOOKED_OK"
# 2) caller marker
$assignCallerFile = Find-FirstContaining "/api/dispatch/assign"

# Build exactly 3 unique files:
$files = New-Object System.Collections.Generic.List[string]
$files.Add($assignPath)

if ($bookMarkerFile -and ($files -notcontains $bookMarkerFile)) { $files.Add($bookMarkerFile) }
if ($assignCallerFile -and ($files -notcontains $assignCallerFile)) { $files.Add($assignCallerFile) }

# If still <3, add passenger ride page if exists
$fallbackRide = Join-Path $proj "app\ride\page.tsx"
if ($files.Count -lt 3 -and (Test-Path -LiteralPath $fallbackRide) -and ($files -notcontains $fallbackRide)) {
  $files.Add($fallbackRide)
}

# If still <3, add passenger booking API route guess if exists
$fallbackBookApi = Join-Path $proj "app\api\public\passenger\book\route.ts"
if ($files.Count -lt 3 -and (Test-Path -LiteralPath $fallbackBookApi) -and ($files -notcontains $fallbackBookApi)) {
  $files.Add($fallbackBookApi)
}

while ($files.Count -gt 3) { $files.RemoveAt($files.Count - 1) }

if ($files.Count -ne 3) {
  Write-Host ""
  Write-Host "Resolved files so far:" -ForegroundColor Yellow
  $files | ForEach-Object { Write-Host " - $_" }
  throw "Could not resolve exactly 3 files. (Found $($files.Count))."
}

# Create staging
$outDir = Join-Path $proj ("_diag_out_$ts")
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$stageDir = Join-Path $outDir "assign_triage_3files"
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

# Copy files preserving relative path
for ($i=0; $i -lt $files.Count; $i++) {
  $src = $files[$i]
  $rel = $src.Substring($proj.Length).TrimStart('\')
  $dest = Join-Path $stageDir $rel
  $destParent = Split-Path -Parent $dest
  New-Item -ItemType Directory -Path $destParent -Force | Out-Null
  Copy-Item -LiteralPath $src -Destination $dest -Force
}

# Manifest
$manifest = Join-Path $stageDir "_MANIFEST.txt"
@(
  "JRIDE assign triage bundle (V2)",
  "Timestamp: $ts",
  "",
  "Included files:"
) + ($files | ForEach-Object { " - " + $_ }) | Set-Content -LiteralPath $manifest -Encoding utf8

# Zip
$zipPath = Join-Path $outDir ("JRIDE_ASSIGN_TRIAGE_3FILES_V2_$ts.zip")
Compress-Archive -LiteralPath (Join-Path $stageDir "*") -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "[OK] Created zip:" -ForegroundColor Green
Write-Host "  $zipPath"
Write-Host ""
Write-Host "Included:" -ForegroundColor Cyan
$files | ForEach-Object { Write-Host " - $_" }