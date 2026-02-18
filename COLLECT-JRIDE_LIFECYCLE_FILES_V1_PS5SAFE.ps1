param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot,

  [string]$OutDir = ""
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Say($m){ Write-Host $m }
function Ensure-Dir([string]$p){
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}
function Copy-IfExists([string]$src, [string]$destDir){
  if (Test-Path -LiteralPath $src) {
    $leaf = Split-Path -Leaf $src
    Copy-Item -LiteralPath $src -Destination (Join-Path $destDir $leaf) -Force
    Say ("[OK] Copied: {0}" -f $src)
    return $true
  } else {
    Say ("[..] Missing: {0}" -f $src)
    return $false
  }
}
function Rel([string]$full){
  $root = (Resolve-Path -LiteralPath $ProjRoot).Path.TrimEnd('\')
  $f = (Resolve-Path -LiteralPath $full).Path
  if ($f.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $f.Substring($root.Length).TrimStart('\')
  }
  return $f
}
function SafeFileName([string]$s){
  $bad = [System.IO.Path]::GetInvalidFileNameChars()
  foreach($c in $bad){ $s = $s.Replace([string]$c, "_") }
  return $s
}

# --- Validate root ---
if (-not (Test-Path -LiteralPath $ProjRoot)) { throw "ProjRoot not found: $ProjRoot" }
$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path

# --- Output folder ---
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = Join-Path $ProjRoot ("_collect_lifecycle_{0}" -f $stamp)
}
Ensure-Dir $OutDir

$filesDir = Join-Path $OutDir "files"
Ensure-Dir $filesDir

Say "== COLLECT JRIDE lifecycle/dispatch/passenger tracking files (V1 / PS5-safe) =="
Say ("Repo: {0}" -f $ProjRoot)
Say ("Out : {0}" -f $OutDir)

# --- 1) Known paths (your usual upload set) ---
$known = @(
  "app\admin\livetrips\LiveTripsClient.tsx",
  "app\admin\livetrips\LiveTripsMap.tsx",
  "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx",
  "app\admin\livetrips\components\TripWalletPanel.tsx",
  "app\admin\livetrips\components\TripLifecycleActions.tsx",
  "app\api\admin\livetrips\page-data\route.ts",
  "app\api\dispatch\assign\route.ts",
  "app\api\dispatch\status\route.ts",
  "app\api\public\passenger\track\route.ts",
  "app\api\passenger\track\route.ts"
)

$manifest = New-Object System.Collections.Generic.List[string]
$copied = New-Object System.Collections.Generic.List[string]

foreach($rel in $known){
  $src = Join-Path $ProjRoot $rel
  if (Test-Path -LiteralPath $src) {
    $destSub = Join-Path $filesDir (Split-Path -Parent $rel)
    Ensure-Dir $destSub
    Copy-Item -LiteralPath $src -Destination (Join-Path $destSub (Split-Path -Leaf $src)) -Force
    $copied.Add($rel) | Out-Null
  }
  $manifest.Add($rel) | Out-Null
}

# --- 2) Smart search: routes likely involved in lifecycle ---
# We’ll copy any route.ts that references these keywords.
$keywords = @(
  "dispatch", "assign", "auto-assign", "autassign", "status", "trip", "on_the_way",
  "arrived", "enroute", "on_trip", "dropoff", "complete", "fare_proposed", "proposed_fare",
  "passenger_fare_response", "customer_status", "driver_status", "dispatch_actions",
  "bookings", "driver_locations", "tracking", "track"
)

Say ""
Say "== Scanning for API route.ts files with lifecycle keywords =="
$routes = Get-ChildItem -LiteralPath (Join-Path $ProjRoot "app") -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ieq "route.ts" }

foreach($r in $routes){
  $hit = $false
  try {
    $content = Get-Content -LiteralPath $r.FullName -Raw -ErrorAction Stop
    foreach($k in $keywords){
      if ($content -match [regex]::Escape($k)) { $hit = $true; break }
    }
  } catch {
    # ignore unreadable
    $hit = $false
  }

  if ($hit) {
    $relp = Rel $r.FullName
    $destSub2 = Join-Path $filesDir (Split-Path -Parent $relp)
    Ensure-Dir $destSub2
    Copy-Item -LiteralPath $r.FullName -Destination (Join-Path $destSub2 (Split-Path -Leaf $r.FullName)) -Force
    if (-not $copied.Contains($relp)) { $copied.Add($relp) | Out-Null }
  }
}

# --- 3) Also collect auth.ts / middleware.ts if present (can block routes, cause null session) ---
Say ""
Say "== Collecting auth/middleware (if present) =="
$maybe = @("auth.ts","middleware.ts","next.config.js","next.config.mjs")
foreach($m in $maybe){
  $p = Join-Path $ProjRoot $m
  if (Test-Path -LiteralPath $p) {
    Copy-Item -LiteralPath $p -Destination (Join-Path $filesDir $m) -Force
    $relp = Rel $p
    if (-not $copied.Contains($relp)) { $copied.Add($relp) | Out-Null }
    Say ("[OK] Copied: {0}" -f $relp)
  }
}

# --- 4) Write manifest ---
$manifestPath = Join-Path $OutDir "MANIFEST.txt"
$copiedPath   = Join-Path $OutDir "COPIED.txt"

"Requested paths:" | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$manifest | Sort-Object | Add-Content -LiteralPath $manifestPath -Encoding UTF8

"" | Add-Content -LiteralPath $manifestPath -Encoding UTF8
"Copied paths:" | Add-Content -LiteralPath $manifestPath -Encoding UTF8
$copied | Sort-Object | Add-Content -LiteralPath $manifestPath -Encoding UTF8

$copied | Sort-Object | Set-Content -LiteralPath $copiedPath -Encoding UTF8

# --- 5) Zip ---
$zipName = ("JRIDE_LIFECYCLE_COLLECT_{0}.zip" -f $stamp)
$zipPath = Join-Path $ProjRoot $zipName

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($OutDir, $zipPath)

Say ""
Say ("[OK] ZIP created: {0}" -f $zipPath)
Say ("[OK] Folder kept : {0}" -f $OutDir)
Say ""
Say "Send me the ZIP."
