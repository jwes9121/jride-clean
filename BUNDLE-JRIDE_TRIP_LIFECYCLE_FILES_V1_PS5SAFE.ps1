param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot,

  [Parameter(Mandatory=$false)]
  [string]$AndroidRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function Ensure-Dir($p){
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

function Copy-One($src, $dst){
  if (Test-Path -LiteralPath $src) {
    Ensure-Dir (Split-Path -Parent $dst)
    Copy-Item -LiteralPath $src -Destination $dst -Force
    Ok ("[COPY] " + $src)
    return $true
  } else {
    Warn ("[MISS] " + $src)
    return $false
  }
}

function Copy-IfFound($root, $rel, $outRoot, $label){
  $src = Join-Path $root $rel
  $dst = Join-Path $outRoot (Join-Path $label $rel)
  Copy-One $src $dst | Out-Null
}

function Copy-FirstMatch($root, $pattern, $outRoot, $label){
  $hits = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction Stop |
    Where-Object {
      $_.FullName -notmatch '\\node_modules\\' -and
      $_.FullName -notmatch '\\\.next\\' -and
      $_.FullName -notmatch '\\_diag_out_' -and
      $_.FullName -notmatch '\\dist\\' -and
      $_.FullName -notmatch '\\build\\' -and
      $_.Name -like $pattern
    } |
    Select-Object -First 1

  if ($null -ne $hits) {
    $rel = $hits.FullName.Substring($root.Length).TrimStart('\')
    $dst = Join-Path $outRoot (Join-Path $label $rel)
    Copy-One $hits.FullName $dst | Out-Null
  } else {
    Warn ("[MISS] FirstMatch pattern: " + $pattern)
  }
}

Info "== BUNDLE JRIDE: Trip Lifecycle file pack (V1 / PS5-safe) =="

$web = (Resolve-Path -LiteralPath $WebRoot).Path
Info ("WebRoot: " + $web)

$android = ""
if ($AndroidRoot -and $AndroidRoot.Trim().Length -gt 0) {
  $android = (Resolve-Path -LiteralPath $AndroidRoot).Path
  Info ("AndroidRoot: " + $android)
} else {
  Warn "AndroidRoot not provided; will bundle WEB only."
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $web ("_diag_out_trip_lifecycle_" + $ts)
Ensure-Dir $outDir

$bundleDir = Join-Path $outDir "bundle"
Ensure-Dir $bundleDir

$log = Join-Path $outDir "BUNDLE_LOG.txt"
"JRIDE Trip Lifecycle Bundle V1" | Out-File -FilePath $log -Encoding UTF8
("Timestamp: " + $ts) | Out-File -FilePath $log -Encoding UTF8 -Append
("WebRoot: " + $web) | Out-File -FilePath $log -Encoding UTF8 -Append
if ($android) { ("AndroidRoot: " + $android) | Out-File -FilePath $log -Encoding UTF8 -Append }

Info "---- Copy WEB targets ----"

# Core LiveTrips/admin pages
Copy-IfFound $web "app\admin\livetrips\LiveTripsClient.tsx" $bundleDir "web"
Copy-IfFound $web "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx" $bundleDir "web"
Copy-IfFound $web "app\admin\livetrips\components\LiveTripsMap.tsx" $bundleDir "web"

# Optional UI files if present (trip lifecycle buttons/panels)
Copy-FirstMatch $web "TripLifecycleActions.tsx" $bundleDir "web"
Copy-FirstMatch $web "TripWalletPanel.tsx" $bundleDir "web"

# Driver locations APIs (source + wrapper)
Copy-IfFound $web "app\api\driver_locations\route.ts" $bundleDir "web"
Copy-IfFound $web "app\api\admin\driver_locations\route.ts" $bundleDir "web"

# LiveTrips page-data route (if exists in your repo)
Copy-IfFound $web "app\api\admin\livetrips\page-data\route.ts" $bundleDir "web"
Copy-IfFound $web "app\api\admin\livetrips\page-data\route.js" $bundleDir "web"

# Dispatch routes (assign + status)
Copy-IfFound $web "app\api\dispatch\assign\route.ts" $bundleDir "web"
Copy-IfFound $web "app\api\dispatch\status\route.ts" $bundleDir "web"

# Driver ping route (common path we’ve seen)
Copy-IfFound $web "app\api\driver\location\ping\route.ts" $bundleDir "web"

# Also include any route files that mention trip lifecycle (small targeted search)
Info "Searching WEB for likely trip lifecycle API routes..."
$keywords = @("trip", "lifecycle", "status", "start", "arrived", "on_the_way", "on_trip", "complete", "completed")
$apiRoot = Join-Path $web "app\api"
if (Test-Path -LiteralPath $apiRoot) {
  $candidates = Get-ChildItem -LiteralPath $apiRoot -Recurse -File -ErrorAction Stop |
    Where-Object {
      $_.FullName -notmatch '\\node_modules\\' -and
      $_.FullName -notmatch '\\\.next\\' -and
      $_.FullName -notmatch '\\_diag_out_' -and
      $_.Name -in @("route.ts","route.js")
    }

  foreach ($f in $candidates) {
    $txt = ""
    try { $txt = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 } catch { continue }
    $hit = $false
    foreach ($k in $keywords) {
      if ($txt -match [regex]::Escape($k)) { $hit = $true; break }
    }
    if ($hit) {
      $rel = $f.FullName.Substring($web.Length).TrimStart('\')
      $dst = Join-Path $bundleDir (Join-Path "web" $rel)
      Copy-One $f.FullName $dst | Out-Null
    }
  }
} else {
  Warn "[MISS] Web API root not found: app\api"
}

# Include minimal config context
Copy-IfFound $web "package.json" $bundleDir "web"
Copy-IfFound $web "next.config.js" $bundleDir "web"
Copy-IfFound $web "next.config.mjs" $bundleDir "web"
Copy-IfFound $web "middleware.ts" $bundleDir "web"
Copy-IfFound $web "auth.ts" $bundleDir "web"

Info "---- Copy ANDROID targets ----"
if ($android) {
  # Core service that drives pings
  Copy-IfFound $android "app\src\main\java\com\jride\app\LocationUpdateService.kt" $bundleDir "android"

  # Common app entry / networking / trip screens (copy if they exist)
  Copy-FirstMatch $android "MainActivity.kt" $bundleDir "android"
  Copy-FirstMatch $android "*Trip*.kt" $bundleDir "android"
  Copy-FirstMatch $android "*Booking*.kt" $bundleDir "android"
  Copy-FirstMatch $android "*Api*.kt" $bundleDir "android"
  Copy-FirstMatch $android "*Network*.kt" $bundleDir "android"

  # Manifest + gradle for permissions/foreground service
  Copy-IfFound $android "app\src\main\AndroidManifest.xml" $bundleDir "android"
  Copy-IfFound $android "app\build.gradle" $bundleDir "android"
  Copy-IfFound $android "build.gradle" $bundleDir "android"
  Copy-IfFound $android "app\build.gradle.kts" $bundleDir "android"
  Copy-IfFound $android "build.gradle.kts" $bundleDir "android"
}

# Zip it
$zip = Join-Path $web ("JRIDE_TRIP_LIFECYCLE_BUNDLE_" + $ts + ".zip")
Info ("Creating ZIP: " + $zip)

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -LiteralPath (Join-Path $outDir "bundle\*") -DestinationPath $zip -Force

if (-not (Test-Path -LiteralPath $zip)) {
  throw "ZIP not created: $zip"
}

Ok ("ZIP created: " + $zip)
Ok ("Bundle folder: " + $outDir)

Info "DONE."