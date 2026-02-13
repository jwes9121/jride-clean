param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

$target = Join-Path $RepoRoot "app\api\passenger\track\route.ts"
if (-not (Test-Path $target)) { Fail "[FAIL] Missing: $target" }

$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("passenger.track.route.ts.bak.TYPE_GUARD_V1." + $stamp)
Copy-Item $target $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# We look for the line that defines driverId from booking.* and insert a type guard immediately before it.
$needle = 'const\s+driverId\s*=\s*\(booking\.driver_id\s*\|\|\s*booking\.assigned_driver_id\)'
if (-not ([regex]::IsMatch($content, $needle))) {
  Fail "[FAIL] Could not find driverId assignment line in passenger/track route.ts"
}

$guard = @'
  // === JRIDE_TRACK_TYPE_GUARD_V1 ===
  // booking can be a typed error union; ensure it is a row object before accessing fields.
  if (!booking || typeof booking !== "object") {
    return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
  }
  if ("error" in (booking as any) && (booking as any).error) {
    return NextResponse.json({ ok: false, error: (booking as any).error }, { status: 400 });
  }
  // === END JRIDE_TRACK_TYPE_GUARD_V1 ===

'@

$content2 = [regex]::Replace($content, $needle, ($guard + '  ' + '$0'), 1)

Set-Content -LiteralPath $target -Value $content2 -Encoding UTF8
Ok ("[OK] Patched: {0}" -f $target)
Ok "[OK] Done."
