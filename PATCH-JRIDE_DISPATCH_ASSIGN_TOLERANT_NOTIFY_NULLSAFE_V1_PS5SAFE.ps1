#requires -Version 5.1
<#
PATCH JRIDE WEB: dispatch assign tolerant route null-safe final booking
PS5-safe, ASCII-only
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) { throw $msg }

function EnsureDir($p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
  }
}

function ReadText($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing file: $path"
  }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function WriteTextUtf8NoBom($path, $content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

function BackupFile($src, $bakDir, $tag) {
  EnsureDir $bakDir
  if (Test-Path -LiteralPath $src) {
    $name = [System.IO.Path]::GetFileName($src)
    $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
    $dst = Join-Path $bakDir ($name + ".bak." + $tag + "." + $stamp)
    Copy-Item -LiteralPath $src -Destination $dst -Force
    return $dst
  }
  return $null
}

function ReplaceLiteralOnce($content, $find, $replace, $label) {
  $idx = $content.IndexOf($find)
  if ($idx -lt 0) { Fail "PATCH FAIL ($label): literal not found." }
  $idx2 = $content.IndexOf($find, $idx + $find.Length)
  if ($idx2 -ge 0) { Fail "PATCH FAIL ($label): literal appears multiple times. Refuse to patch." }
  return $content.Replace($find, $replace)
}

Write-Host "== PATCH JRIDE WEB: dispatch assign null-safe final booking (V1 / PS5-safe) ==" -ForegroundColor Cyan

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$target = Join-Path $root "app\api\dispatch\assign\route.ts"
$bakDir = Join-Path $root "_patch_bak"

if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$content = ReadText $target
$bak = BackupFile $target $bakDir "DISPATCH_ASSIGN_NULLSAFE_FINAL_V1"
if ($bak) { Write-Host "[OK] Backup: $bak" }

$old1 = @'
    let notifyOk = false;
    let notifyDuplicate = false;
    let notifyError: string | null = null;

    const notifyRes = await insertDriverNotificationBestEffort(admin, chosenDriverId, updated);
'@

$new1 = @'
    const finalBooking = updated;
    if (!finalBooking) {
      return jErr("ASSIGN_FINAL_BOOKING_MISSING", "Assigned booking could not be reloaded.", 500, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        driver_id: chosenDriverId,
      });
    }

    let notifyOk = false;
    let notifyDuplicate = false;
    let notifyError: string | null = null;

    const notifyRes = await insertDriverNotificationBestEffort(admin, chosenDriverId, finalBooking);
'@

$content = ReplaceLiteralOnce $content $old1 $new1 "INSERT_FINALBOOKING_GUARD"

$old2 = @'
      booking_id: updated.id,
      booking_code: updated.booking_code,
'@

$new2 = @'
      booking_id: finalBooking.id,
      booking_code: finalBooking.booking_code,
'@

$content = ReplaceLiteralOnce $content $old2 $new2 "USE_FINALBOOKING_IN_RESPONSE"

WriteTextUtf8NoBom $target $content
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "Done."