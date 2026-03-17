param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$Path) {
  if (!(Test-Path $Path)) { throw "Missing file: $Path" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Backup-File([string]$Path, [string]$Tag) {
  $Dir = Split-Path -Parent $Path
  $BakDir = Join-Path $Dir "_patch_bak"
  if (!(Test-Path $BakDir)) {
    New-Item -ItemType Directory -Path $BakDir -Force | Out-Null
  }
  $Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $Name = Split-Path $Path -Leaf
  $Bak = Join-Path $BakDir "$Name.bak.$Tag.$Stamp"
  Copy-Item $Path $Bak -Force
  return $Bak
}

Write-Host "== PATCH JRIDE PASSENGER BOOK TO AUTO-ASSIGN V1 (PS5-safe) =="

$target = Join-Path $WebRoot "app\api\public\passenger\book\route.ts"
if (!(Test-Path $target)) { throw "Target file not found: $target" }

$bak = Backup-File -Path $target -Tag "PASSENGER_BOOK_TO_AUTO_ASSIGN_V1"
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$text = Read-Text $target
$original = $text

# -------------------------------------------------------------------
# 1) Broaden normalizeAssignResult so auto-assign success payloads count as ok.
# -------------------------------------------------------------------
$oldNormalize = @'
function normalizeAssignResult(j: any) {
  const src = j || {};
  const ok =
    !!src.ok ||
    !!src.assign_ok ||
    !!src.update_ok ||
    !!src.notify_ok ||
    !!src.assigned_driver_id ||
    !!src.driver_id ||
    !!src.toDriverId;

  return {
    ...src,
    ok,
  };
}
'@

$newNormalize = @'
function normalizeAssignResult(j: any) {
  const src = j || {};
  const ok =
    !!src.ok ||
    !!src.success ||
    !!src.assign_ok ||
    !!src.update_ok ||
    !!src.notify_ok ||
    !!src.assigned_driver_id ||
    !!src.assignedDriverId ||
    !!src.driver_id ||
    !!src.toDriverId ||
    !!src.chosen_driver_id;

  return {
    ...src,
    ok,
  };
}
'@

if ($text.Contains($oldNormalize)) {
  $text = $text.Replace($oldNormalize, $newNormalize)
  Write-Host "[FIX] Expanded normalizeAssignResult for auto-assign payloads." -ForegroundColor Green
} else {
  Write-Host "[INFO] Exact normalizeAssignResult block not found; trying regex fallback..." -ForegroundColor Yellow
  $patternNormalize = '(?s)function\s+normalizeAssignResult\s*\(\s*j:\s*any\s*\)\s*\{.*?\n\}'
  $newText = [regex]::Replace($text, $patternNormalize, $newNormalize, 1)
  if ($newText -ne $text) {
    $text = $newText
    Write-Host "[FIX] Replaced normalizeAssignResult via regex." -ForegroundColor Green
  } else {
    throw "Could not patch normalizeAssignResult safely."
  }
}

# -------------------------------------------------------------------
# 2) Route change: dispatch/assign -> dispatch/auto-assign
# -------------------------------------------------------------------
$routeCount = ([regex]::Matches($text, '/api/dispatch/assign')).Count
$text = $text -replace '/api/dispatch/assign', '/api/dispatch/auto-assign'
$routeCountAfter = ([regex]::Matches($text, '/api/dispatch/auto-assign')).Count

if ($routeCountAfter -lt 1) {
  throw "Could not replace dispatch/assign route references."
}
Write-Host "[FIX] Repointed booking-time assignment calls to /api/dispatch/auto-assign." -ForegroundColor Green

# -------------------------------------------------------------------
# 3) Patch assignPayload object in the ins.error fallback branch
#    from { booking_id: String(booking.id) }
#    to   { bookingId, pickupLat, pickupLng }
# -------------------------------------------------------------------
$patternAssignPayload = 'const\s+assignPayload\s*=\s*\{\s*booking_id\s*:\s*String\(booking\.id\)\s*\};'
$replacementAssignPayload = @'
const assignPayload = {
          bookingId: String(booking.id),
          pickupLat: Number(body.pickup_lat),
          pickupLng: Number(body.pickup_lng),
        };
'@
$newText = [regex]::Replace($text, $patternAssignPayload, $replacementAssignPayload, 1)
if ($newText -ne $text) {
  $text = $newText
  Write-Host "[FIX] Patched assignPayload in fallback booking branch." -ForegroundColor Green
} else {
  Write-Host "[INFO] Fallback assignPayload anchor not found." -ForegroundColor Yellow
}

# -------------------------------------------------------------------
# 4) Patch direct JSON body in the normal insert-success branch
#    from { booking_id: String(booking.id) }
#    to   { bookingId, pickupLat, pickupLng }
# -------------------------------------------------------------------
$patternDirectBody = 'body:\s*JSON\.stringify\(\s*\{\s*booking_id\s*:\s*String\(booking\.id\)\s*\}\s*\),'
$replacementDirectBody = @'
body: JSON.stringify({
        bookingId: String(booking.id),
        pickupLat: Number(body.pickup_lat),
        pickupLng: Number(body.pickup_lng),
      }),
'@
$newText2 = [regex]::Replace($text, $patternDirectBody, $replacementDirectBody, 1)
if ($newText2 -ne $text) {
  $text = $newText2
  Write-Host "[FIX] Patched direct auto-assign request body in normal booking branch." -ForegroundColor Green
} else {
  Write-Host "[INFO] Direct booking JSON body anchor not found." -ForegroundColor Yellow
}

if ($text -eq $original) {
  throw "No changes were applied. Aborting."
}

Write-Utf8NoBom -Path $target -Content $text
Write-Host "[OK] Wrote: $target" -ForegroundColor Green
Write-Host ""
Write-Host "Patched file:" -ForegroundColor Cyan
Write-Host " - $target"
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1) npm run build"
Write-Host "  2) git status"
Write-Host "  3) test a fresh booking after deploy"