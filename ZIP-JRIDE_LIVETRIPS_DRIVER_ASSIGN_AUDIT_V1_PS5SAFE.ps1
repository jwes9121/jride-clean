# ZIP-JRIDE_LIVETRIPS_DRIVER_ASSIGN_AUDIT_V1_PS5SAFE.ps1
# Collects LiveTrips + dispatch/driver routes for audit and zips them.
# PS5-safe, no mojibake, Windows-friendly.

param(
  [Parameter(Mandatory=$false)]
  [string]$ProjRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
if (!(Test-Path -LiteralPath $proj)) { Fail "[FAIL] ProjRoot not found: $proj" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $proj ("_diag_out_" + $ts)
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$zipPath = Join-Path $outDir ("jride_livetrips_driver_assign_audit_" + $ts + ".zip")

Info "== JRIDE ZIP Collector: LiveTrips + Driver Assign Audit (V1 / PS5-safe) =="
Info "Repo   : $proj"
Info "OutDir : $outDir"
Info "Zip    : $zipPath"

# Helper: copy file if exists (preserve relative path)
function Copy-RelFile([string]$absPath) {
  if (!(Test-Path -LiteralPath $absPath)) { return $false }
  $rel = $absPath.Substring($proj.Length).TrimStart('\')
  $dest = Join-Path $outDir $rel
  $destDir = Split-Path -Parent $dest
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  Copy-Item -LiteralPath $absPath -Destination $dest -Force
  return $true
}

# Helper: copy whole directory if exists
function Copy-RelDir([string]$absDir) {
  if (!(Test-Path -LiteralPath $absDir)) { return 0 }
  $items = Get-ChildItem -LiteralPath $absDir -Recurse -File
  foreach ($it in $items) { Copy-RelFile $it.FullName | Out-Null }
  return $items.Count
}

# 1) Always include LiveTrips admin folder
$ltDir = Join-Path $proj "app\admin\livetrips"
if (!(Test-Path -LiteralPath $ltDir)) { Fail "[FAIL] Missing: $ltDir" }
$cntLt = Copy-RelDir $ltDir
Ok "[OK] Copied LiveTrips files: $cntLt"

# 2) Include common backend routes (if present)
$knownRoutes = @(
  "app\api\admin\livetrips\page-data\route.ts",
  "app\api\dispatch\assign\route.ts",
  "app\api\dispatch\status\route.ts",
  "app\api\driver\active-booking\route.ts",
  "app\api\driver\booking\route.ts",
  "app\api\driver\poll\route.ts"
)

foreach ($r in $knownRoutes) {
  $p = Join-Path $proj $r
  if (Copy-RelFile $p) { Ok "[OK] Included: $r" }
}

# 3) Auto-discover other likely relevant route.ts files by keyword scanning
Info "Scanning for route.ts files related to assign/dispatch/driver/booking/poll..."
$allRoutes = Get-ChildItem -LiteralPath (Join-Path $proj "app\api") -Recurse -File -Filter "route.ts" -ErrorAction SilentlyContinue
$keywords = @("assign", "dispatch", "driver", "booking", "active", "poll", "livetrips", "wallet", "status")
$matched = @()

foreach ($f in $allRoutes) {
  $hit = $false
  try {
    $text = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction Stop
    foreach ($k in $keywords) {
      if ($text -match [regex]::Escape($k)) { $hit = $true; break }
    }
  } catch { }
  if ($hit) { $matched += $f.FullName }
}

$matched = @($matched | Sort-Object -Unique)
foreach ($m in $matched) {
  Copy-RelFile $m | Out-Null
}
Ok ("[OK] Auto-included route.ts matches: " + $matched.Length)

# 4) Include auth.ts and middleware.ts if present (can affect driver visibility / redirects)
$authTs = Join-Path $proj "auth.ts"
$mwTs = Join-Path $proj "middleware.ts"
if (Copy-RelFile $authTs) { Ok "[OK] Included: auth.ts" }
if (Copy-RelFile $mwTs)   { Ok "[OK] Included: middleware.ts" }

# 5) Include package.json + next.config if present (build hooks, runtime)
$pkg = Join-Path $proj "package.json"
$nxc = Join-Path $proj "next.config.js"
$nxts = Join-Path $proj "next.config.ts"
if (Copy-RelFile $pkg)  { Ok "[OK] Included: package.json" }
if (Copy-RelFile $nxc)  { Ok "[OK] Included: next.config.js" }
if (Copy-RelFile $nxts) { Ok "[OK] Included: next.config.ts" }

# 6) Include scripts guard (node) if present
$guardJs = Join-Path $proj "scripts\check-livetrips-ascii.js"
if (Copy-RelFile $guardJs) { Ok "[OK] Included: scripts/check-livetrips-ascii.js" }

# 7) Write an index manifest
$manifest = Join-Path $outDir "MANIFEST.txt"
$filesOut = Get-ChildItem -LiteralPath $outDir -Recurse -File |
  Where-Object { $_.FullName -notlike "*.zip" } |
  Select-Object -ExpandProperty FullName |
  Sort-Object

@(
  "JRIDE LiveTrips + Driver Assign Audit Zip"
  "Repo: $proj"
  "Created: $ts"
  ""
  "Files:"
  ($filesOut | ForEach-Object { $_.Substring($outDir.Length).TrimStart('\') })
) | Set-Content -LiteralPath $manifest -Encoding utf8

Ok "[OK] Wrote manifest: $manifest"

# 8) Create zip
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -LiteralPath $outDir\* -DestinationPath $zipPath -Force
Ok "[OK] Created zip: $zipPath"

Info "DONE. Upload the zip from:"
Write-Host $zipPath