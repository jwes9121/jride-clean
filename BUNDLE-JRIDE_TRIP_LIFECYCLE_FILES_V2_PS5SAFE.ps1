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
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
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
  [void](Copy-One $src $dst)
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
    [void](Copy-One $hits.FullName $dst)
  } else {
    Warn ("[MISS] FirstMatch pattern: " + $pattern)
  }
}

Info "== BUNDLE JRIDE: Trip Lifecycle file pack (V2 / PS5-safe / reliable zip) =="

$web = (Resolve-Path -LiteralPath $WebRoot).Path
Info ("WebRoot: " + $web)

$android = ""
if ($AndroidRoot -and $AndroidRoot.Trim().Length -gt 0) {
  $android = (Resolve-Path -LiteralPath $AndroidRoot).Path
  Info ("AndroidRoot: " + $android)
} else {
  Warn "AndroidRoot not provided; bundling WEB only."
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"

# Use short path output to avoid Windows path length issues
$tempBase = "C:\temp\JRIDE_BUNDLE"
Ensure-Dir $tempBase

$outDir = Join-Path $tempBase ("trip_lifecycle_" + $ts)
$bundleDir = Join-Path $outDir "bundle"
Ensure-Dir $bundleDir

$log = Join-Path $outDir "BUNDLE_LOG.txt"
"JRIDE Trip Lifecycle Bundle V2" | Out-File -FilePath $log -Encoding UTF8
("Timestamp: " + $ts) | Out-File -FilePath $log -Encoding UTF8 -Append
("WebRoot: " + $web) | Out-File -FilePath $log -Encoding UTF8 -Append
if ($android) { ("AndroidRoot: " + $android) | Out-File -FilePath $log -Encoding UTF8 -Append }
("OutDir: " + $outDir) | Out-File -FilePath $log -Encoding UTF8 -Append

Info "---- Copy WEB targets ----"
Copy-IfFound $web "app\admin\livetrips\LiveTripsClient.tsx" $bundleDir "web"
Copy-IfFound $web "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx" $bundleDir "web"
Copy-IfFound $web "app\admin\livetrips\components\LiveTripsMap.tsx" $bundleDir "web"

Copy-FirstMatch $web "TripLifecycleActions.tsx" $bundleDir "web"
Copy-FirstMatch $web "TripWalletPanel.tsx" $bundleDir "web"

Copy-IfFound $web "app\api\driver_locations\route.ts" $bundleDir "web"
Copy-IfFound $web "app\api\admin\driver_locations\route.ts" $bundleDir "web"
Copy-IfFound $web "app\api\admin\livetrips\page-data\route.ts" $bundleDir "web"
Copy-IfFound $web "app\api\dispatch\assign\route.ts" $bundleDir "web"
Copy-IfFound $web "app\api\dispatch\status\route.ts" $bundleDir "web"
Copy-IfFound $web "app\api\driver\location\ping\route.ts" $bundleDir "web"

Info "Searching WEB for likely trip lifecycle API routes..."
$keywords = @("trip","lifecycle","status","start","arrived","on_the_way","on_trip","complete","completed","fare_proposed","driver_accepted")
$apiRoot = Join-Path $web "app\api"
if (Test-Path -LiteralPath $apiRoot) {
  $routes = Get-ChildItem -LiteralPath $apiRoot -Recurse -File -ErrorAction Stop |
    Where-Object {
      $_.FullName -notmatch '\\node_modules\\' -and
      $_.FullName -notmatch '\\\.next\\' -and
      $_.FullName -notmatch '\\_diag_out_' -and
      $_.Name -in @("route.ts","route.js")
    }

  foreach ($f in $routes) {
    $txt = ""
    try { $txt = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 } catch { continue }
    $hit = $false
    foreach ($k in $keywords) { if ($txt -match [regex]::Escape($k)) { $hit = $true; break } }
    if ($hit) {
      $rel = $f.FullName.Substring($web.Length).TrimStart('\')
      $dst = Join-Path $bundleDir (Join-Path "web" $rel)
      [void](Copy-One $f.FullName $dst)
    }
  }
} else {
  Warn "[MISS] Web API root not found: app\api"
}

Copy-IfFound $web "package.json" $bundleDir "web"
Copy-IfFound $web "next.config.js" $bundleDir "web"
Copy-IfFound $web "next.config.mjs" $bundleDir "web"
Copy-IfFound $web "middleware.ts" $bundleDir "web"
Copy-IfFound $web "auth.ts" $bundleDir "web"

Info "---- Copy ANDROID targets ----"
if ($android) {
  Copy-IfFound $android "app\src\main\java\com\jride\app\LocationUpdateService.kt" $bundleDir "android"
  Copy-FirstMatch $android "MainActivity.kt" $bundleDir "android"
  Copy-FirstMatch $android "*Trip*.kt" $bundleDir "android"
  Copy-FirstMatch $android "*Booking*.kt" $bundleDir "android"
  Copy-FirstMatch $android "*Api*.kt" $bundleDir "android"
  Copy-FirstMatch $android "*Network*.kt" $bundleDir "android"
  Copy-IfFound $android "app\src\main\AndroidManifest.xml" $bundleDir "android"
  Copy-IfFound $android "app\build.gradle" $bundleDir "android"
  Copy-IfFound $android "build.gradle" $bundleDir "android"
  Copy-IfFound $android "app\build.gradle.kts" $bundleDir "android"
  Copy-IfFound $android "build.gradle.kts" $bundleDir "android"
}

# Count files copied
$fileCount = (Get-ChildItem -LiteralPath $bundleDir -Recurse -File -ErrorAction Stop | Measure-Object).Count
Info ("Files bundled: " + $fileCount)
if ($fileCount -eq 0) { throw "Bundle is empty; refusing to zip." }

# Create zip (reliable)
$zipTemp = Join-Path $tempBase ("JRIDE_TRIP_LIFECYCLE_BUNDLE_" + $ts + ".zip")
if (Test-Path -LiteralPath $zipTemp) { Remove-Item -LiteralPath $zipTemp -Force }

Info ("Creating ZIP (ZipFile): " + $zipTemp)
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

try {
  [System.IO.Compression.ZipFile]::CreateFromDirectory($bundleDir, $zipTemp, [System.IO.Compression.CompressionLevel]::Optimal, $false)
} catch {
  Warn ("ZipFile failed: " + $_.Exception.Message)
  Warn "Falling back to Compress-Archive..."
  Compress-Archive -Path (Join-Path $bundleDir "*") -DestinationPath $zipTemp -Force
}

if (-not (Test-Path -LiteralPath $zipTemp)) {
  throw "ZIP not created: $zipTemp"
}

# Copy zip back into repo root for easy upload
$zipFinal = Join-Path $web ("JRIDE_TRIP_LIFECYCLE_BUNDLE_" + $ts + ".zip")
Copy-Item -LiteralPath $zipTemp -Destination $zipFinal -Force

Ok ("ZIP created: " + $zipFinal)
Ok ("Working bundle folder: " + $outDir)
Ok "DONE."