# PATCH-JRIDE_PHASE3L_ASSIGN_LOCK.ps1
# Phase 3L:
# - Prevent assign / reassign once trip is completed or cancelled
# - Server-side enforcement (TRIP_LOCKED)
# - No UI / Mapbox changes

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

function Find-RepoRoot([string]$startDir) {
  $d = Resolve-Path $startDir
  while ($true) {
    if (Test-Path (Join-Path $d "package.json")) { return $d }
    $parent = Split-Path $d -Parent
    if ($parent -eq $d) { break }
    $d = $parent
  }
  Fail "Could not find repo root (package.json)."
}

$root   = Find-RepoRoot (Get-Location).Path
$target = Join-Path $root "app\api\dispatch\assign\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts  = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "[OK] Backup: $bak"

$src = Get-Content $target -Raw

# Guard snippet (inserted immediately after booking fetch)
$guard = @"
  // PHASE 3L: lock completed / cancelled trips
  if (['completed','cancelled'].includes(String(booking?.status || '').toLowerCase())) {
    return NextResponse.json(
      {
        ok: false,
        code: 'TRIP_LOCKED',
        message: 'Trip already completed or cancelled',
        booking_id: booking.id,
        booking_code: booking.booking_code ?? null,
        status: booking.status
      },
      { status: 409 }
    );
  }
"@

# Insert guard once, right after booking is loaded
if ($src -match "const booking\s*=\s*") {
  if ($src -notmatch "TRIP_LOCKED") {
    $src = $src -replace "(const booking\s*=\s*[^\n]+\n)", "`$1$guard`n"
  }
} else {
  Fail "Could not locate booking load block. No changes applied."
}

Set-Content -LiteralPath $target -Value $src -Encoding utf8
Ok "[OK] Patched: $target"
Ok "DONE"
