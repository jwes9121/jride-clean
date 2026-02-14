param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE Patch: Passenger /public/passenger/booking treats assigned+fare states as ongoing (V1 / PS5-safe) ==" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$target = Join-Path $ProjRoot "app\api\public\passenger\booking\route.ts"
if (-not (Test-Path -LiteralPath $target)) { Fail "[FAIL] Target not found: $target" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("public-passenger-booking.route.ts.bak.ACTIVE_STATUSES_V1.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$txt = Get-Content -LiteralPath $target -Raw

# Our desired active statuses (keep as array literal in TS)
$desired = 'const ACTIVE_STATUSES = ["pending","searching","requested","assigned","accepted","fare_proposed","ready","on_the_way","arrived","enroute","on_trip"];'

# Patch strategy:
# 1) If file already has ACTIVE_STATUSES const, replace its contents.
# 2) Else, if it uses .in("status", something) with a local var like "active", we insert ACTIVE_STATUSES and swap to it.
$did = $false

if ($txt -match 'const\s+ACTIVE_STATUSES\s*=\s*\[[^\]]*\]\s*;') {
  $txt = [regex]::Replace($txt, 'const\s+ACTIVE_STATUSES\s*=\s*\[[^\]]*\]\s*;', $desired, 1)
  Ok "[OK] Replaced existing ACTIVE_STATUSES"
  $did = $true
}

if (-not $did) {
  # Insert ACTIVE_STATUSES near the top (after imports) and use it in the first .in("status", ...)
  if ($txt -match '\.in\(\s*["'']status["'']\s*,\s*([a-zA-Z0-9_]+)\s*\)') {
    $m = [regex]::Match($txt, '\.in\(\s*["'']status["'']\s*,\s*([a-zA-Z0-9_]+)\s*\)')
    $varName = $m.Groups[1].Value

    # Insert const after last import line
    if ($txt -match '(?s)(^import[^\n]*\n(?:import[^\n]*\n)*)') {
      $txt = [regex]::Replace($txt, '(?s)(^import[^\n]*\n(?:import[^\n]*\n)*)', "`$1`r`n$desired`r`n", 1)
      Ok "[OK] Inserted ACTIVE_STATUSES after imports"
    } else {
      # If no imports found, insert at top
      $txt = "$desired`r`n`r`n$txt"
      Ok "[OK] Inserted ACTIVE_STATUSES at top"
    }

    # Replace .in("status", <varName>) -> .in("status", ACTIVE_STATUSES)
    $pat = "\.in\(\s*['" + '"' + "']status['" + '"' + "']\s*,\s*" + [regex]::Escape($varName) + "\s*\)"
    $txt = [regex]::Replace($txt, $pat, '.in("status", ACTIVE_STATUSES)', 1)
    Ok ("[OK] Switched .in(""status"", {0}) to ACTIVE_STATUSES" -f $varName)
    $did = $true
  }
}

if (-not $did) {
  Fail "[FAIL] Could not locate ACTIVE_STATUSES or a .in(""status"", ...) filter in passenger booking route. Paste that file's status filter section."
}

# Write UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)
Ok ("[OK] Wrote: {0}" -f $target)

Write-Host ""
Write-Host "NEXT: build, commit, push, deploy. Then /ride should show ongoing booking when status is assigned/fare_proposed/etc." -ForegroundColor Cyan
