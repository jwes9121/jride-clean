# PATCH-HIDE-DASHCODE-TRIP-AND-SCAN-MOJIBAKE.ps1
# - Hides trips whose booking_code is empty OR only dashes (e.g. "-----") OR "null/undefined"
# - Scrubs mojibake in key UI files
# - Scans repo for any remaining mojibake (prints file + line)
# - Nukes .next to force rebuild

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }

$ts = Stamp
$root = Get-Location

$liveTrips = "app\admin\livetrips\LiveTripsClient.tsx"
$smartSug  = "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"
$dispatch  = "app\dispatch\page.tsx"

$targets = @($liveTrips, $smartSug, $dispatch)

Write-Host "[0/6] Repo: $root" -ForegroundColor Cyan

# --- backups ---
Write-Host "[1/6] Backups..." -ForegroundColor Cyan
foreach ($f in $targets) {
  if (!(Test-Path $f)) { Fail "Missing file: $f" }
  Copy-Item $f "$f.bak.$ts" -Force
  Write-Host "  [OK] $f.bak.$ts" -ForegroundColor Green
}

# --- UTF-8 no BOM helpers ---
function ReadUtf8NoBom([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes((Join-Path $root $path))
  return [System.Text.UTF8Encoding]::new($false).GetString($bytes)
}
function WriteUtf8NoBom([string]$path, [string]$text) {
  $enc = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllBytes((Join-Path $root $path), $enc.GetBytes($text))
}

# --- mojibake scrub ---
function FixMojibake([string]$t) {
  $t = $t.Replace("â€¦", "...")
  $t = $t.Replace("…", "...")
  $t = $t.Replace("â€¢", " - ")
  $t = $t.Replace("•", " - ")
  $t = $t.Replace("", "")
  return $t
}

# --- robust patch LiveTrips loadPage() ---
Write-Host "[2/6] Patch LiveTripsClient.tsx (hide invalid booking codes)..." -ForegroundColor Cyan
$lt = ReadUtf8NoBom $liveTrips
$lt = FixMojibake $lt

if ($lt -notmatch "async function loadPage\(") { Fail "Could not find loadPage() in $liveTrips" }
if ($lt -notmatch "const normalized\s*=\s*trips\.map") { Fail "Could not find 'const normalized = trips.map' in $liveTrips" }
if ($lt -notmatch "setAllTrips\s*\(") { Fail "Could not find setAllTrips(...) in $liveTrips" }

# Remove older inserted blocks (best-effort) to prevent duplicates
$lt = $lt -replace "(?s)\n\s*// UI safety: hide rows without booking_code\.[\s\S]*?const cleaned\s*=\s*normalized\.filter\([\s\S]*?\);\s*\n", "`n"
$lt = $lt -replace "(?s)\n\s*// UI safety: hide rows without booking_code\.[\s\S]*?setAllTrips\(cleaned\);\s*\n", "`n"

# Insert cleaned filter after the normalized block (first occurrence)
$rxNormBlock = [regex]"const\s+normalized\s*=\s*trips\.map\([\s\S]*?\);\s*"
$m = $rxNormBlock.Match($lt)
if (-not $m.Success) { Fail "Could not locate end of normalized mapping in $liveTrips" }

$cleanInsert = @'
  // UI safety: hide invalid booking codes that cannot be progressed.
  // Some backend rows come through with booking_code like "-----" or "null" and break dispatcher flow.
  const cleaned = normalized.filter((t) => {
    const raw = String(t.booking_code ?? "").trim();
    if (!raw) return false;
    const low = raw.toLowerCase();
    if (low === "null" || low === "undefined") return false;
    // reject codes that are only dashes, e.g. "-----"
    if (/^-+$/.test(raw)) return false;
    return true;
  });

'@

if ($lt -notmatch "const\s+cleaned\s*=\s*normalized\.filter") {
  $lt = $rxNormBlock.Replace($lt, $m.Value + $cleanInsert, 1)
}

# Force the first setAllTrips(...) AFTER loadPage() declaration to use cleaned
$pos = $lt.IndexOf("async function loadPage")
if ($pos -lt 0) { Fail "Unexpected: loadPage() not found index" }
$head = $lt.Substring(0, $pos)
$tail = $lt.Substring($pos)

$rxSetAll = [regex]"setAllTrips\s*\(\s*[^)]+\s*\)\s*;"
if (-not $rxSetAll.IsMatch($tail)) { Fail "Could not find setAllTrips(...) statement inside loadPage region" }
$tail = $rxSetAll.Replace($tail, "setAllTrips(cleaned);", 1)

$lt = $head + $tail

WriteUtf8NoBom $liveTrips $lt
Write-Host "  [OK] Patched $liveTrips" -ForegroundColor Green

# --- scrub mojibake in the other two ---
Write-Host "[3/6] Scrub mojibake in SmartAutoAssignSuggestions + Dispatch..." -ForegroundColor Cyan
foreach ($f in @($smartSug, $dispatch)) {
  $t0 = ReadUtf8NoBom $f
  $t1 = FixMojibake $t0
  if ($t1 -ne $t0) {
    WriteUtf8NoBom $f $t1
    Write-Host "  [OK] Scrubbed $f" -ForegroundColor Green
  } else {
    Write-Host "  [OK] No changes $f" -ForegroundColor Green
  }
}

# --- nuke .next to avoid stale compiled output ---
Write-Host "[4/6] Removing .next (force clean rebuild)..." -ForegroundColor Cyan
if (Test-Path ".next") {
  Remove-Item ".next" -Recurse -Force
  Write-Host "  [OK] .next removed" -ForegroundColor Green
} else {
  Write-Host "  [OK] .next not found (skip)" -ForegroundColor Green
}

# --- scan repo for mojibake ---
Write-Host "[5/6] Repo scan for mojibake (â//Ã)..." -ForegroundColor Cyan
$bad = @()
Get-ChildItem -Path (Join-Path $root "app") -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx | ForEach-Object {
  $p = $_.FullName
  $txt = [System.IO.File]::ReadAllText($p, [System.Text.UTF8Encoding]::new($false))
  if ($txt -match "[âÃ]") {
    $lines = $txt -split "`n"
    for ($i=0; $i -lt $lines.Length; $i++) {
      if ($lines[$i] -match "[âÃ]") {
        $bad += ("{0}:{1}: {2}" -f ($p.Replace($root.Path + "\", "")), ($i+1), $lines[$i].Trim())
      }
    }
  }
}

if ($bad.Count -gt 0) {
  Write-Host "  [FOUND] Mojibake occurrences:" -ForegroundColor Yellow
  $bad | Select-Object -First 80 | ForEach-Object { Write-Host "   $_" -ForegroundColor Yellow }
  Write-Host "  (Showing first 80 hits only.)" -ForegroundColor Yellow
} else {
  Write-Host "  [OK] No mojibake found under app/." -ForegroundColor Green
}

Write-Host "[6/6] Done." -ForegroundColor Green
Write-Host ""
Write-Host "NEXT (IMPORTANT): restart dev server, then run:" -ForegroundColor Yellow
Write-Host "  npm.cmd run build"
Write-Host "  npm.cmd run dev"
