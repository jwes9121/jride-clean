param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function EnsureDir([string]$p){
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

function CopyIfExists([string]$src, [string]$dstDir, [ref]$manifest){
  $rel = $src.Substring($ProjRoot.Length).TrimStart("\","/")
  if (Test-Path -LiteralPath $src) {
    $dstPath = Join-Path $dstDir $rel
    $dstParent = Split-Path -Parent $dstPath
    EnsureDir $dstParent
    Copy-Item -LiteralPath $src -Destination $dstPath -Force
    $manifest.Value += "OK   $rel"
    return $true
  } else {
    $manifest.Value += "MISS $rel"
    return $false
  }
}

Info "== JRIDE Collect: LiveTrips UI + Map diagnostics (V2 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"

# Use a SHORT path staging folder to avoid Windows path-length issues during zipping
$stageRoot = Join-Path $env:TEMP ("JRIDE_DIAG_" + $ts)
$outDir    = Join-Path $stageRoot "out"
$bundleDir = Join-Path $outDir "bundle"

EnsureDir $bundleDir

$manifest = @()
$manifest += ("Timestamp: " + (Get-Date).ToString("s"))
$manifest += ("ProjRoot:  " + $ProjRoot)
$manifest += ("StageDir:  " + $stageRoot)
$manifest += ""

$paths = @(
  # LiveTrips UI
  "app\admin\livetrips\LiveTripsClient.tsx",
  "app\admin\livetrips\page.tsx",

  # LiveTrips components (map + panels + helpers)
  "app\admin\livetrips\components\LiveTripsMap.tsx",
  "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx",
  "app\admin\livetrips\components\DispatchActionPanel.tsx",
  "app\admin\livetrips\components\ProblemTripAlertSounds.tsx",
  "app\admin\livetrips\components\TripLifecycleActions.tsx",
  "app\admin\livetrips\components\TripWalletPanel.tsx",

  # API routes involved in driver locations + live trips page data
  "app\api\driver_locations\route.ts",
  "app\api\driver-locations\route.ts",
  "app\api\admin\driver_locations\route.ts",
  "app\api\admin\driver-locations\route.ts",
  "app\api\admin\livetrips\page-data\route.ts",
  "app\api\admin\debug-livetrips\route.ts",

  # Dispatch routes commonly wired from LiveTrips
  "app\api\dispatch\assign\route.ts",
  "app\api\dispatch\status\route.ts",
  "app\api\admin\manual-assign\route.ts",
  "app\api\admin\auto-assign\route.ts",

  # Mapbox/env related (NOTE: you may remove .env.local from the zip before uploading)
  "next.config.js",
  "next.config.mjs",
  ".env.local",
  "app\layout.tsx",
  "app\globals.css",

  # ASCII guard script that blocks build
  "scripts\check-livetrips-ascii.js"
)

Info "== Copying files to staging bundle =="
$hit = 0
$miss = 0
foreach ($p in $paths) {
  $abs = Join-Path $ProjRoot $p
  $ok = CopyIfExists $abs $bundleDir ([ref]$manifest)
  if ($ok) { $hit++ } else { $miss++ }
}

$manifest += ""
$manifest += ("Copied:  " + $hit)
$manifest += ("Missing: " + $miss)
$manifest += ""

$manifest += "---- BUNDLE FILE LIST (relative / bytes / lastwrite) ----"
$items = Get-ChildItem -LiteralPath $bundleDir -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName
foreach ($f in $items) {
  $rel = $f.FullName.Substring($bundleDir.Length).TrimStart("\","/")
  $manifest += ("FILE {0} | {1} bytes | {2}" -f $rel, $f.Length, $f.LastWriteTime.ToString("s"))
}

$manifestPath = Join-Path $outDir "MANIFEST.txt"
[System.IO.File]::WriteAllLines($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))
Ok "[OK] Wrote: $manifestPath"

# Zip using .NET (more reliable than Compress-Archive under some setups)
Info ""
Info "== Creating ZIP (via System.IO.Compression.ZipFile) =="
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipName = "JRIDE_LIVETRIPS_UI_MAP_DIAG_$ts.zip"
$tmpZip  = Join-Path $stageRoot $zipName
$finalZip = Join-Path $ProjRoot $zipName

if (Test-Path -LiteralPath $tmpZip)   { Remove-Item -LiteralPath $tmpZip -Force }
if (Test-Path -LiteralPath $finalZip) { Remove-Item -LiteralPath $finalZip -Force }

try {
  [System.IO.Compression.ZipFile]::CreateFromDirectory($outDir, $tmpZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
} catch {
  Fail ("[FAIL] Zip creation failed: " + $_.Exception.Message)
}

if (!(Test-Path -LiteralPath $tmpZip)) { Fail "[FAIL] Zip not created at staging path: $tmpZip" }

Copy-Item -LiteralPath $tmpZip -Destination $finalZip -Force

if (!(Test-Path -LiteralPath $finalZip)) { Fail "[FAIL] Zip not copied to repo root: $finalZip" }

Ok "[OK] Created ZIP:"
Write-Host $finalZip -ForegroundColor Green

Info ""
Info "== NEXT =="
Info "1) Upload the ZIP here."
Info "2) If .env.local is inside and you don't want to share it: open the zip, delete .env.local, then upload."