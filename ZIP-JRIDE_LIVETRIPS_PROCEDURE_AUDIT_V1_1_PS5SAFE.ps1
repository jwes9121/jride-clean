param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot,

  [string]$OutDir = "",

  [switch]$IncludeSupabaseMigrations
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }

function Ensure-Dir([string]$p){
  if(-not (Test-Path -LiteralPath $p)){
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

function Copy-IfExists([string]$src, [string]$dst){
  if(Test-Path -LiteralPath $src){
    Ensure-Dir ([System.IO.Path]::GetDirectoryName($dst))
    Copy-Item -LiteralPath $src -Destination $dst -Force
    return $true
  }
  return $false
}

function Copy-Glob([string]$likePattern, [string]$projRoot, [string]$bundleRoot){
  $items = Get-ChildItem -LiteralPath $projRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like $likePattern }

  $count = 0
  foreach($it in $items){
    $rel = $it.FullName.Substring($projRoot.Length).TrimStart("\","/")

    # Skip big dirs / junk / secrets defensively
    if($rel -match '(^|\\|/)node_modules(\\|/)') { continue }
    if($rel -match '(^|\\|/)\.next(\\|/)')       { continue }
    if($rel -match '(^|\\|/)\.git(\\|/)')        { continue }
    if($rel -match '(^|\\|/)dist(\\|/)')         { continue }
    if($rel -match '(^|\\|/)build(\\|/)')        { continue }
    if($rel -match '(^|\\|/)_diag_out_')         { continue }  # FIXED: removed invalid \_
    if($rel -match '(^|\\|/)_patch_bak(\\|/)')   { continue }
    if($rel -match '(^|\\|/)JRIDE_.*\.zip$')     { continue }
    if($rel -match '(^|\\|/)\.env(\.|$)')        { continue }

    $dst = Join-Path $bundleRoot $rel
    Ensure-Dir ([System.IO.Path]::GetDirectoryName($dst))
    Copy-Item -LiteralPath $it.FullName -Destination $dst -Force
    $count++
  }
  return $count
}

# --- Main ---
if(-not (Test-Path -LiteralPath $ProjRoot)){ Fail "[FAIL] ProjRoot not found: $ProjRoot" }
$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path

$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")

if([string]::IsNullOrWhiteSpace($OutDir)){
  $OutDir = $ProjRoot
} else {
  Ensure-Dir $OutDir
  $OutDir = (Resolve-Path -LiteralPath $OutDir).Path
}

$work = Join-Path $ProjRoot ("_audit_bundle_" + $stamp)
Ensure-Dir $work

Info "== JRIDE ZIP AUDIT (LiveTrips procedure) =="
Info ("Repo: {0}" -f $ProjRoot)
Info ("Work: {0}" -f $work)

# Explicit file list (most important)
$files = @(
  ".editorconfig",
  "package.json",
  "next.config.js",
  "next.config.mjs",
  "tsconfig.json",
  "middleware.ts",
  "auth.ts",
  "app\api\auth\[...nextauth]\route.ts",
  "scripts\check-livetrips-ascii.js",

  # LiveTrips UI
  "app\admin\livetrips\LiveTripsClient.tsx",
  "app\admin\livetrips\LiveTripsMap.tsx",
  "app\admin\livetrips\components\LiveTripsMap.tsx",
  "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx",
  "app\admin\livetrips\components\TripWalletPanel.tsx",
  "app\admin\livetrips\components\TripLifecycleActions.tsx",

  # Backend routes (dispatch + page data)
  "app\api\admin\livetrips\page-data\route.ts",
  "app\api\admin\livetrips\page-data-v2\route.ts",
  "app\api\dispatch\assign\route.ts",
  "app\api\dispatch\status\route.ts",

  # Live location endpoints (common variants)
  "app\api\live-location\route.ts",
  "app\api\live_location\route.ts",
  "app\api\driver-locations\route.ts",
  "app\api\driver_locations\route.ts",
  "app\api\admin\driver-locations\route.ts",
  "app\api\admin\driver_locations\route.ts"
)

$copied = 0
$missing = 0

foreach($rel in $files){
  $src = Join-Path $ProjRoot $rel
  $dst = Join-Path $work $rel
  if(Copy-IfExists $src $dst){
    $copied++
  } else {
    $missing++
  }
}

# Include all livetrips folder (still excludes env/node_modules via filters)
$globCount = Copy-Glob "*\app\admin\livetrips\*" $ProjRoot $work
Info ("[INFO] Additional copied via glob (app/admin/livetrips): {0}" -f $globCount)

# Optionally include Supabase migrations
if($IncludeSupabaseMigrations){
  $supabaseDir = Join-Path $ProjRoot "supabase\migrations"
  if(Test-Path -LiteralPath $supabaseDir){
    Ensure-Dir (Join-Path $work "supabase\migrations")
    Copy-Item -LiteralPath $supabaseDir -Destination (Join-Path $work "supabase") -Recurse -Force
    Info "[INFO] Included supabase/migrations"
  } else {
    Warn "[WARN] supabase/migrations not found (skipped)"
  }
}

# Double-safety: remove .env* if accidentally copied
Get-ChildItem -LiteralPath $work -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^\.env(\..*)?$' } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

# Create zip
$zipName = "JRIDE_LIVETRIPS_AUDIT_" + $stamp + ".zip"
$zipPath = Join-Path $OutDir $zipName
if(Test-Path -LiteralPath $zipPath){ Remove-Item -LiteralPath $zipPath -Force }

Compress-Archive -LiteralPath (Join-Path $work "*") -DestinationPath $zipPath -Force

Ok ("[OK] ZIP created: {0}" -f $zipPath)
Info ("[INFO] Explicit files copied: {0}, missing (ok): {1}" -f $copied, $missing)

# Cleanup temp
try {
  Remove-Item -LiteralPath $work -Recurse -Force
  Info "[INFO] Cleaned temp bundle folder."
} catch {
  Warn "[WARN] Could not remove temp folder. You can delete it manually:"
  Warn ("       {0}" -f $work)
}

Info "Done."