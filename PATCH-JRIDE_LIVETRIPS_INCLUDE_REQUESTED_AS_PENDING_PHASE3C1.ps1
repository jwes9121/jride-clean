$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Fail($m){ throw $m }

$path = Join-Path (Get-Location) "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $path)) { Fail "Missing: $path (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Idempotent guard
if ($txt -match "PHASE3C1_EFFECTIVE_STATUS_USED") {
  Ok "[OK] Phase 3C1 already applied. No changes made."
  exit 0
}

# ---- Patch 1: counts use effectiveStatus(t) instead of t.status ----
$needle1 = 'const s = normStatus(t.status);'
if ($txt -notmatch [regex]::Escape($needle1)) {
  Fail "Could not find counts status line: $needle1"
}
$txt = $txt.Replace(
  $needle1,
  "const s = effectiveStatus(t); // PHASE3C1_EFFECTIVE_STATUS_USED"
)

# ---- Patch 2: visibleTrips filters use effectiveStatus(t) ----
$needle2 = 'out = allTrips.filter((t) => ["pending", "assigned", "on_the_way"].includes(normStatus(t.status)));'
if ($txt -notmatch [regex]::Escape($needle2)) {
  Fail "Could not find dispatch filter line (visibleTrips). File differs."
}
$txt = $txt.Replace(
  $needle2,
  'out = allTrips.filter((t) => ["pending", "assigned", "on_the_way"].includes(effectiveStatus(t)));'
)

$needle3 = 'out = allTrips.filter((t) => normStatus(t.status) === f);'
if ($txt -notmatch [regex]::Escape($needle3)) {
  Fail "Could not find status==filter line (visibleTrips). File differs."
}
$txt = $txt.Replace(
  $needle3,
  'out = allTrips.filter((t) => effectiveStatus(t) === f);'
)

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt, $utf8)

Ok "[OK] Patched LiveTrips to treat requested as pending via effectiveStatus()."
Ok "[NEXT] npm run build, deploy, then check /admin/livetrips Pending/Dispatch tabs."
