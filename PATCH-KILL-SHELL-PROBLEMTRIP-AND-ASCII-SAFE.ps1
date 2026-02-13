# PATCH-KILL-SHELL-PROBLEMTRIP-AND-ASCII-SAFE.ps1
# - Drops "shell" trips that show as ----- PROBLEM and cannot be progressed
# - Forces ASCII-only in key UI files (kills mojibake without embedding mojibake chars in this PS1)
# - Removes .next for a clean rebuild

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

# --- backup ---
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

# --- ASCII sanitizer (no mojibake literals inside this PS1) ---
function ToAscii([string]$t) {
  # Replace common unicode punctuation by heuristic (anything non-ascii -> '-')
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $t.ToCharArray()) {
    $code = [int][char]$ch
    if ($ch -eq "`n" -or $ch -eq "`r" -or $ch -eq "`t") {
      [void]$sb.Append($ch)
      continue
    }
    if ($code -ge 32 -and $code -le 126) {
      [void]$sb.Append($ch)
    } else {
      # normalize all non-ascii to a dash
      [void]$sb.Append("-")
    }
  }
  return $sb.ToString()
}

function HasNonAscii([string]$t) {
  foreach ($ch in $t.ToCharArray()) {
    $code = [int][char]$ch
    if ($ch -eq "`n" -or $ch -eq "`r" -or $ch -eq "`t") { continue }
    if ($code -lt 32 -or $code -gt 126) { return $true }
  }
  return $false
}

# --- Patch LiveTripsClient: drop shell trips inside loadPage() ---
Write-Host "[2/6] Patch LiveTripsClient.tsx (drop shell trips)..." -ForegroundColor Cyan
$lt = ReadUtf8NoBom $liveTrips
$lt = ToAscii $lt

if ($lt -notmatch "async function loadPage\(") { Fail "Could not find loadPage() in $liveTrips" }
if ($lt -notmatch "const normalized\s*=\s*trips\.map") { Fail "Could not find 'const normalized = trips.map' in $liveTrips" }
if ($lt -notmatch "setAllTrips\s*\(") { Fail "Could not find setAllTrips(...) in $liveTrips" }

# Remove older inserted cleaned block (best-effort)
$lt = $lt -replace "(?s)\n\s*// UI safety: drop shell trips.*?const cleaned\s*=\s*normalized\.filter\([\s\S]*?\);\s*\n", "`n"

# Insert cleaned right after normalized mapping block (first occurrence)
$rxNormBlock = [regex]"const\s+normalized\s*=\s*trips\.map\([\s\S]*?\);\s*"
$m = $rxNormBlock.Match($lt)
if (-not $m.Success) { Fail "Could not locate end of normalized mapping in $liveTrips" }

$cleanInsert = @'
  // UI safety: drop shell trips that cannot be progressed.
  // Shell signature: fake/blank booking_code AND no meaningful fields (labels/coords/driver/zone).
  const cleaned = normalized.filter((t) => {
    const code = String(t.booking_code ?? "").trim();
    const low = code.toLowerCase();
    const codeLooksFake = (!code) || (low === "null") || (low === "undefined") || (/^-+$/.test(code));

    const hasPassenger = !!String(t.passenger_name ?? "").trim();
    const hasPickupLbl = !!String(t.pickup_label ?? "").trim();
    const hasDropLbl = !!String(t.dropoff_label ?? "").trim();
    const hasZone = !!String((t.zone ?? t.town ?? "")).trim();
    const hasDriver = !!String(t.driver_id ?? "").trim();

    const hasPickupCoords = Number.isFinite(t.pickup_lat as any) && Number.isFinite(t.pickup_lng as any);
    const hasDropCoords = Number.isFinite(t.dropoff_lat as any) && Number.isFinite(t.dropoff_lng as any);

    const meaningful =
      hasPassenger || hasPickupLbl || hasDropLbl || hasZone || hasDriver || hasPickupCoords || hasDropCoords;

    if (codeLooksFake && !meaningful) return false;
    if (/^-+$/.test(code)) return false;

    return true;
  });

'@

if ($lt -notmatch "const\s+cleaned\s*=\s*normalized\.filter") {
  $lt = $rxNormBlock.Replace($lt, $m.Value + $cleanInsert, 1)
}

# Force the first setAllTrips(...) after loadPage() to use cleaned
$pos = $lt.IndexOf("async function loadPage")
if ($pos -lt 0) { Fail "Unexpected: loadPage() not found index" }
$head = $lt.Substring(0, $pos)
$tail = $lt.Substring($pos)

$rxSetAll = [regex]"setAllTrips\s*\(\s*[^)]+\s*\)\s*;"
if (-not $rxSetAll.IsMatch($tail)) { Fail "Could not find setAllTrips(...) inside loadPage region" }
$tail = $rxSetAll.Replace($tail, "setAllTrips(cleaned);", 1)

$lt = $head + $tail

WriteUtf8NoBom $liveTrips $lt
Write-Host "  [OK] Patched $liveTrips" -ForegroundColor Green

# --- ASCII scrub other two files ---
Write-Host "[3/6] ASCII scrub SmartAutoAssignSuggestions + Dispatch..." -ForegroundColor Cyan
foreach ($f in @($smartSug, $dispatch)) {
  $t0 = ReadUtf8NoBom $f
  $t1 = ToAscii $t0
  if ($t1 -ne $t0) {
    WriteUtf8NoBom $f $t1
    Write-Host "  [OK] Scrubbed $f" -ForegroundColor Green
  } else {
    Write-Host "  [OK] No changes $f" -ForegroundColor Green
  }
}

# --- remove .next ---
Write-Host "[4/6] Remove .next (force clean rebuild)..." -ForegroundColor Cyan
if (Test-Path ".next") {
  Remove-Item ".next" -Recurse -Force
  Write-Host "  [OK] .next removed" -ForegroundColor Green
} else {
  Write-Host "  [OK] .next not found (skip)" -ForegroundColor Green
}

# --- validate ASCII-only in the 3 files ---
Write-Host "[5/6] Validate ASCII-only in target files..." -ForegroundColor Cyan
foreach ($f in $targets) {
  $t = ReadUtf8NoBom $f
  if (HasNonAscii $t) { Fail "Non-ASCII still present in $f (unexpected). Aborting." }
  Write-Host "  [OK] $f ASCII-only" -ForegroundColor Green
}

Write-Host "[6/6] Done." -ForegroundColor Green
Write-Host ""
Write-Host "NEXT: Stop dev server (Ctrl+C), then run:" -ForegroundColor Yellow
Write-Host "  npm.cmd run build"
Write-Host "  npm.cmd run dev"
