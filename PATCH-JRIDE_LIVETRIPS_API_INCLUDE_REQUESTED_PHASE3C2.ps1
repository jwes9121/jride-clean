$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ throw $m }

$root = (Get-Location).Path
$base = Join-Path $root "app\api\admin\livetrips"
if (!(Test-Path $base)) { Fail "Missing folder: $base (run from repo root)" }

$routes = Get-ChildItem -LiteralPath $base -Recurse -File -Filter "route.ts"
if (!$routes -or $routes.Count -eq 0) { Fail "No route.ts found under $base" }

# Pick the most likely: contains bookings + .in(status...) + pending/assigned/on_the_way
$candidates = @()
foreach ($f in $routes) {
  $t = Get-Content -LiteralPath $f.FullName -Raw
  if ($t -match "from\((`"|')bookings(`"|')\)" -and $t -match "\.in\(\s*([`"|'])status\1" -and $t -match "pending" ) {
    $candidates += [pscustomobject]@{ Path=$f.FullName; Text=$t }
  }
}

if ($candidates.Count -eq 0) {
  Warn "[WARN] No obvious bookings status .in('status', [...]) filter found under app/api/admin/livetrips."
  Warn "[NEXT] Paste the file path of your LiveTrips page-data route (usually app/api/admin/livetrips/page-data/route.ts)."
  exit 1
}

# Choose best candidate: prefer path containing page-data
$target = $candidates | Sort-Object @{Expression={ if ($_.Path -match "page-data") {0} else {1} }}, @{Expression={ $_.Path.Length }} | Select-Object -First 1
$path = $target.Path
$txt = $target.Text

Ok "[OK] Target route: $path"

# Idempotent guard
if ($txt -match "PHASE3C2_INCLUDE_REQUESTED") {
  Ok "[OK] Phase 3C2 already applied. No changes made."
  exit 0
}

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $bak"

# Replace first .in("status",[...]) that includes pending but not requested
$pattern = '(?s)\.in\(\s*([`"''"])status\1\s*,\s*\[(?<arr>.*?)\]\s*\)'
$m = [regex]::Match($txt, $pattern)
if (!$m.Success) { Fail "Could not find a .in('status', [..]) call in target route." }

$arr = $m.Groups["arr"].Value

if ($arr -match "requested") {
  Ok "[OK] Status filter already includes 'requested' (no edit needed)."
  exit 0
}

if ($arr -notmatch "pending") {
  Warn "[WARN] Found status .in() but it doesn't contain 'pending'. Not patching to avoid unintended edits."
  Warn "[NEXT] Paste the status filter block from $path"
  exit 1
}

# Insert "requested" right after "pending" (handles single/double quotes)
# Example: 'pending', -> 'pending', 'requested',
$arr2 = $arr -replace "(['`""]pending['`""]\s*,)", "`$1 'requested',"

if ($arr2 -eq $arr) {
  # fallback: pending might be last element
  $arr2 = $arr -replace "(['`""]pending['`""]\s*)", "`$1, 'requested'"
}

$newIn = ".in(" + $m.Groups[1].Value + "status" + $m.Groups[1].Value + ", [" + $arr2 + "]) /* PHASE3C2_INCLUDE_REQUESTED */"

# Apply only the first match
$txt2 = $txt.Substring(0, $m.Index) + $newIn + $txt.Substring($m.Index + $m.Length)

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt2, $utf8)

Ok "[OK] Patched LiveTrips page-data API to include 'requested' (Phase 3C2)."
Ok "[NEXT] Build, deploy, then create a new takeout order and re-check /admin/livetrips."
