# PATCH-HIDE-NOBOOKINGCODE-AND-FIX-MOJIBAKE.ps1
# Run from repo root

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }

$ts = Stamp
$root = Get-Location

$liveTrips = "app\admin\livetrips\LiveTripsClient.tsx"
$smartSug  = "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"
$dispatch  = "app\dispatch\page.tsx"

$targets = @($liveTrips, $smartSug, $dispatch)

Write-Host "[0/5] Repo: $root" -ForegroundColor Cyan

# --- backup ---
Write-Host "[1/5] Backups..." -ForegroundColor Cyan
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
  # convert common mojibake sequences and unicode punctuation into plain ASCII
  $t = $t.Replace("â€¦", "...")
  $t = $t.Replace("…", "...")
  $t = $t.Replace("â€¢", " - ")
  $t = $t.Replace("•", " - ")
  $t = $t.Replace("", "")
  return $t
}

function CountBad([string]$t) {
  # anything that screams encoding trouble
  ($t.ToCharArray() | Where-Object { $_ -match "[âÃ]" }).Count
}

# --- patch LiveTripsClient: hide any rows without booking_code ---
Write-Host "[2/5] Patch LiveTripsClient.tsx (hide no-booking_code rows)..." -ForegroundColor Cyan
$lt = ReadUtf8NoBom $liveTrips
$lt = FixMojibake $lt

# We patch at the single stable point: right after `const normalized = trips.map((t) => ({ ... }))`
# and before `setZones(z);` / `setAllTrips(normalized);`
if ($lt -notmatch "const normalized = trips\.map\(\(t\) => \(\{") { Fail "Could not find normalized mapping block in $liveTrips" }
if ($lt -notmatch "setAllTrips\(") { Fail "Could not find setAllTrips(...) in $liveTrips" }

# remove any previous attempt to use cleaned/normalized replace (idempotent-ish)
$lt = $lt -replace "(?s)\s*// Hide ghost/malformed rows.*?setAllTrips\(cleaned\);\s*", ""

# enforce: ONLY show trips with a booking_code (because actions + status updates require it)
$insert = @'
    // UI safety: hide rows without booking_code.
    // These cannot be progressed (actions require booking_code) and create "PROBLEM" noise.
    const cleaned = normalized.filter((t) => {
      return !!String(t.booking_code || "").trim();
    });

'@

# Replace the first occurrence of `setAllTrips(normalized);` with cleaned variant, ensuring insert appears just before it.
if ($lt -match "setAllTrips\(normalized\);") {
  $lt = $lt -replace "setAllTrips\(normalized\);", ($insert + "    setAllTrips(cleaned);")
} elseif ($lt -match "setAllTrips\(\s*normalized\s*\)\s*;") {
  $lt = $lt -replace "setAllTrips\(\s*normalized\s*\)\s*;", ($insert + "    setAllTrips(cleaned);")
} else {
  Fail "Could not find setAllTrips(normalized); in $liveTrips"
}

WriteUtf8NoBom $liveTrips $lt
Write-Host "  [OK] Patched $liveTrips" -ForegroundColor Green

# --- scrub other two files ---
Write-Host "[3/5] Scrub mojibake in SmartAutoAssignSuggestions + Dispatch..." -ForegroundColor Cyan
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

# --- hard fail if mojibake remains in these files ---
Write-Host "[4/5] Validate no â//Ã remain (target files)..." -ForegroundColor Cyan
$badTotal = 0
foreach ($f in $targets) {
  $t = ReadUtf8NoBom $f
  $c = CountBad $t
  if ($c -gt 0) {
    Write-Host "  [BAD] $f still contains $c suspicious chars (â//Ã)" -ForegroundColor Red
    $badTotal += $c
  } else {
    Write-Host "  [OK] $f clean" -ForegroundColor Green
  }
}
if ($badTotal -gt 0) {
  Fail "Mojibake still present in patched files. Aborting so we don't pretend it's fixed."
}

Write-Host "[5/5] Done." -ForegroundColor Green
Write-Host ""
Write-Host "NEXT: restart dev server (stop the old one), then run:" -ForegroundColor Yellow
Write-Host "  npm.cmd run build"
Write-Host "  npm.cmd run dev"
