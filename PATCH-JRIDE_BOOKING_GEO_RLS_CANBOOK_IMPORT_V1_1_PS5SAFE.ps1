<#  PATCH-JRIDE_BOOKING_GEO_RLS_CANBOOK_IMPORT_V1_1_PS5SAFE.ps1
    Fixes the V1 script failure (-replace RHS array parsing) and makes backups unique.

    Actions:
    1) Backup can-book + book route with UNIQUE filenames
    2) Patch can-book import to "@/utils/supabase/server"
    3) Insert GEO normalize block (idempotent)
    4) Ensure bookings insert includes created_by_user_id: createdByUserId (RLS)
    5) Add NOT_AUTHED guard if createdByUserId missing
    6) Make verified default to pvVerified (don’t break when passengers table missing)
#>

param(
  [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

function SafeNameFromPath([string]$fullPath){
  $rel = $fullPath
  try {
    $root = (Resolve-Path $RepoRoot).Path
    $p = (Resolve-Path $fullPath).Path
    if ($p.StartsWith($root)) { $rel = $p.Substring($root.Length).TrimStart('\') }
  } catch {}
  $rel = $rel -replace '[\\/:*?"<>|]', '_'
  return $rel
}

function Backup-File([string]$Path, [string]$Tag) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Missing file: $Path" }
  $bakDir = Join-Path $RepoRoot "_patch_bak"
  if (-not (Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }

  $safe = SafeNameFromPath $Path
  $bak = Join-Path $bakDir ("{0}.bak.{1}.{2}" -f $safe, $Tag, (Stamp))
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Ok ("[OK] Backup: {0}" -f $bak)
}

function Read-Text([string]$Path) { Get-Content -LiteralPath $Path -Raw }
function Write-Text([string]$Path, [string]$Content) { Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8 }

Ok "== JRide Patch: GEO normalize + bookings RLS + can-book import (V1.1 / PS5-safe) =="
Ok ("[OK] RepoRoot: {0}" -f (Resolve-Path $RepoRoot))

$canBookPath = Join-Path $RepoRoot "app\api\public\passenger\can-book\route.ts"
$bookPath    = Join-Path $RepoRoot "app\api\public\passenger\book\route.ts"

# ---------------------------
# Patch A: can-book import
# ---------------------------
if (Test-Path -LiteralPath $canBookPath) {
  Backup-File $canBookPath "CANBOOK_IMPORT_V1_1"
  $c = Read-Text $canBookPath

  if ($c -match 'from\s+"(\.\./)+utils/supabase/server"\s*;') {
    $c2 = $c -replace 'from\s+"(\.\./)+utils/supabase/server"\s*;','from "@/utils/supabase/server";'
    Write-Text $canBookPath $c2
    Ok "[OK] Patched can-book import to '@/utils/supabase/server'."
  } else {
    Ok "[OK] can-book import already OK (no change)."
  }
} else {
  Warn ("[WARN] Missing can-book route: {0} (skipping)" -f $canBookPath)
}

# ---------------------------
# Patch B: book route
# ---------------------------
if (-not (Test-Path -LiteralPath $bookPath)) { throw "Missing book route: $bookPath" }
Backup-File $bookPath "BOOK_GEO_RLS_V1_1"

$b = Read-Text $bookPath

# B1) Insert GEO normalize block right after body parsing
if ($b -notmatch 'JRIDE_GEO_NORMALIZE_V1') {
  $pattern = 'const\s+body\s*=\s*\(await\s+req\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\)\)\s+as\s+BookReq\s*;'
  if ($b -match $pattern) {
    $block = @'
const body = (await req.json().catch(() => ({}))) as BookReq;

  // JRIDE_GEO_NORMALIZE_V1
  // Accept either flat pickup_lat/pickup_lng/dropoff_lat/dropoff_lng + from_label/to_label
  // OR objects: pickup{lat,lng,label} dropoff{lat,lng,label}
  // Normalize into flat fields used by GEO gate + insert.
  const _b: any = body as any;
  try {
    if (_b) {
      if ((_b.pickup_lat == null || _b.pickup_lng == null) && _b.pickup && typeof _b.pickup === "object") {
        if (_b.pickup_lat == null && _b.pickup.lat != null) _b.pickup_lat = _b.pickup.lat;
        if (_b.pickup_lng == null && _b.pickup.lng != null) _b.pickup_lng = _b.pickup.lng;
        if ((_b.from_label == null || String(_b.from_label).trim() === "") && _b.pickup.label != null) _b.from_label = _b.pickup.label;
      }

      if ((_b.dropoff_lat == null || _b.dropoff_lng == null) && _b.dropoff && typeof _b.dropoff === "object") {
        if (_b.dropoff_lat == null && _b.dropoff.lat != null) _b.dropoff_lat = _b.dropoff.lat;
        if (_b.dropoff_lng == null && _b.dropoff.lng != null) _b.dropoff_lng = _b.dropoff.lng;
        if ((_b.to_label == null || String(_b.to_label).trim() === "") && _b.dropoff.label != null) _b.to_label = _b.dropoff.label;
      }

      if (_b.pickup_lat == null && _b.pickupLat != null) _b.pickup_lat = _b.pickupLat;
      if (_b.pickup_lng == null && _b.pickupLng != null) _b.pickup_lng = _b.pickupLng;
      if (_b.dropoff_lat == null && _b.dropoffLat != null) _b.dropoff_lat = _b.dropoffLat;
      if (_b.dropoff_lng == null && _b.dropoffLng != null) _b.dropoff_lng = _b.dropoffLng;
    }
  } catch {}
  // JRIDE_GEO_NORMALIZE_V1_END
'@

    $b = [regex]::Replace(
      $b,
      $pattern,
      $block,
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    Ok "[OK] Inserted JRIDE_GEO_NORMALIZE_V1 block."
  } else {
    throw "Could not find the body parse line to insert GEO normalize block."
  }
} else {
  Ok "[OK] GEO normalize block already present (no change)."
}

# B2) Ensure we have createdByUserId and NOT_AUTHED guard (don’t duplicate)
if ($b -notmatch 'code:\s*"NOT_AUTHED"') {
  $guardPattern = 'const\s+createdByUserId\s*=\s*user\?\.\s*id\s*\?\s*String\(user\.id\)\s*:\s*null\s*;'
  if ($b -match $guardPattern) {
    $b = [regex]::Replace(
      $b,
      $guardPattern,
      ('$0' + "`r`n`r`n" +
       '  if (!createdByUserId) {' + "`r`n" +
       '    return NextResponse.json({ ok: false, code: "NOT_AUTHED", message: "Not signed in." }, { status: 401 });' + "`r`n" +
       '  }'),
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    Ok "[OK] Added NOT_AUTHED guard."
  } else {
    Warn "[WARN] Could not find createdByUserId line to add NOT_AUTHED guard (skipping)."
  }
} else {
  Ok "[OK] NOT_AUTHED guard already present (no change)."
}

# B3) Add created_by_user_id into insert payload (RLS)
# Do a safe replace by injecting right after status: "requested",
if ($b -notmatch 'created_by_user_id:\s*createdByUserId') {
  $lhs = 'status:\s*"requested",'
  $rhs = 'status: "requested",' + "`r`n" + '    created_by_user_id: createdByUserId,'
  $b2 = [regex]::Replace($b, $lhs, $rhs, 1)
  if ($b2 -ne $b) {
    $b = $b2
    Ok "[OK] Added created_by_user_id to bookings insert payload."
  } else {
    Warn "[WARN] Could not inject created_by_user_id (status anchor not found)."
  }
} else {
  Ok "[OK] created_by_user_id already present (no change)."
}

# B4) If pvVerified exists, default verified to pvVerified (so missing passengers table doesn’t flip it)
if ($b -match 'let\s+verified\s*=\s*false\s*;') {
  $b = $b -replace 'let\s+verified\s*=\s*false\s*;','let verified = pvVerified;'
  Ok "[OK] Set verified default to pvVerified."
}

# Also ensure legacy verify lookup only runs if not already verified
$b = [regex]::Replace($b, 'if\s*\(\s*user\s*\)\s*\{', 'if (!verified && user) {', 1)

Write-Text $bookPath $b
Ok ("[OK] Patched book route: {0}" -f $bookPath)

Ok ""
Ok "[OK] PATCH V1.1 COMPLETE."
