# PATCH-JRIDE_PHASE3L_ASSIGN_LOCK_V2.ps1
# Phase 3L:
# - Prevent assign / reassign / auto-assign once trip is completed or cancelled
# - Inserts TRIP_LOCKED guard right after: const booking: any = bookingRes.data;
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

$src = [System.IO.File]::ReadAllText($target)

if ($src -match "code:\s*['""]TRIP_LOCKED['""]") {
  Fail "TRIP_LOCKED already present in $target. No changes applied."
}

$anchor = "const booking: any = bookingRes.data;"
if ($src -notmatch [regex]::Escape($anchor)) {
  Fail "Could not find anchor line: $anchor`nNo changes applied."
}

$guard = @"
$anchor

  // PHASE 3L: lock completed / cancelled trips (no further assignment allowed)
  const lockStatus = String(booking?.status ?? "").trim().toLowerCase();
  if (lockStatus === "completed" || lockStatus === "cancelled") {
    return NextResponse.json(
      {
        ok: false,
        code: "TRIP_LOCKED",
        message: "Trip already " + lockStatus + " (assignment disabled)",
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        status: booking.status ?? null,
      },
      { status: 409 }
    );
  }
"@

# Replace the anchor occurrence with anchor+guard
$src2 = $src -replace [regex]::Escape($anchor), [System.Text.RegularExpressions.Regex]::Escape($anchor)
# Undo the escape because we want literal insertion (simpler: direct replace)
$src2 = $src -replace [regex]::Escape($anchor), [System.Text.RegularExpressions.Regex]::Escape($anchor)
# Better: direct .Replace on string
$src2 = $src.Replace($anchor, $guard)

# Write UTF-8 without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $src2, $utf8NoBom)

Ok "[OK] Patched: $target"
Ok "DONE"
