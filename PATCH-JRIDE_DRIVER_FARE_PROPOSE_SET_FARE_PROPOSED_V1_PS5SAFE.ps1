param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE Patch: driver fare/propose sets status=fare_proposed (V1 / PS5-safe) ==" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$target = Join-Path $ProjRoot "app\api\driver\fare\propose\route.ts"
if (-not (Test-Path -LiteralPath $target)) { Fail "[FAIL] Target not found: $target" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("driver-fare-propose.route.ts.bak.FARE_PROPOSED_V1.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

# Read (preserve as text; later write UTF8 no BOM)
$txt = Get-Content -LiteralPath $target -Raw

# Sanity checks
if ($txt -notmatch "proposed_fare") { Fail "[FAIL] proposed_fare not found in file. Wrong target?" }
if ($txt -notmatch "fare\/propose") { Warn "[WARN] Did not see 'fare/propose' text; continuing anyway." }

# 1) Replace the conditional status update with fare_proposed
# Expected current line (from your grep):
#   status: st === "assigned" ? "accepted" : b.status,
$pattern1 = 'status\s*:\s*st\s*===\s*"assigned"\s*\?\s*"accepted"\s*:\s*b\.status\s*,'
if ($txt -match $pattern1) {
  $txt = [regex]::Replace($txt, $pattern1, 'status: "fare_proposed",')
  Ok "[OK] Patched status: conditional -> fare_proposed"
} else {
  # Fallback: if there is ANY "status:" within the update object, refuse to guess.
  if ($txt -match 'proposed_fare\s*:\s*proposed\s*,') {
    Warn "[WARN] Could not find exact conditional status line. Trying a safer anchored patch near proposed_fare..."
    # Insert status right after proposed_fare ONLY if status is not already set to fare_proposed in the same update call.
    if ($txt -match 'proposed_fare\s*:\s*proposed\s*,\s*\r?\n\s*status\s*:') {
      Warn "[WARN] status already present near proposed_fare; not inserting a duplicate."
    } else {
      $txt = [regex]::Replace(
        $txt,
        '(proposed_fare\s*:\s*proposed\s*,)',
        '$1' + "`r`n        status: ""fare_proposed"",",
        1
      )
      Ok "[OK] Inserted status: fare_proposed after proposed_fare"
    }
  } else {
    Fail "[FAIL] Could not locate safe anchor to patch status. Paste app/api/driver/fare/propose/route.ts here."
  }
}

# 2) Optional: update comment (best effort, non-fatal)
$txt = $txt -replace "keep status at 'accepted'","set status to 'fare_proposed'"

# Write UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)
Ok ("[OK] Wrote: {0}" -f $target)

Write-Host ""
Write-Host "NEXT: rebuild and deploy. Then retest the same flow:" -ForegroundColor Cyan
Write-Host " - Driver proposes fare -> bookings.status should become 'fare_proposed'" -ForegroundColor Cyan
Write-Host " - Passenger should immediately see the fare popup" -ForegroundColor Cyan
