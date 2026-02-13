# PATCH-JRIDE_P5A_PASSENGER_UX_POLISH.ps1
# P5A: Passenger UX polish for fare offer panel (UI-only)
# - Emphasize pickup distance fee when > 0
# - Add "Why this fee?" helper text
# - Improve waiting/reject micro-copy
# Anchor-based edits only.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$ROOT = (Get-Location).Path
$Target = Join-Path $ROOT 'app\ride\page.tsx'
if (!(Test-Path $Target)) { Fail "Missing file: $Target" }

# Backup
$ts = (Get-Date).ToString('yyyyMMdd_HHmmss')
Copy-Item $Target ($Target + ".bak." + $ts) -Force
Ok "[OK] Backup: $Target.bak.$ts"

$txt = Get-Content -LiteralPath $Target -Raw
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ---------- 1) Emphasize Pickup Distance Fee when > 0 ----------
# Anchor: the Pickup Distance Fee amount display line using p4Money(pickupFee)
$reFeeLine = [regex]::new(
  '\{p4Money\(pickupFee\)\}',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

if ($reFeeLine.IsMatch($txt)) {
  $txt = $reFeeLine.Replace($txt, '{pickupFee > 0 ? (<span className="text-amber-700 font-bold">{p4Money(pickupFee)}</span>) : (<span>{p4Money(pickupFee)}</span>)}', 1)
  Ok "[OK] Emphasized Pickup Distance Fee when > 0"
} else {
  Info "[WARN] Pickup Distance Fee amount anchor not found (non-fatal)"
}

# ---------- 2) Add inline "Why this fee?" helper under Pickup Distance Fee subtext ----------
$reSubtext = [regex]::new(
  'Free pickup within 1\.5 km\. Additional fee applies if driver is farther\.',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

if ($reSubtext.IsMatch($txt)) {
  $txt = $reSubtext.Replace(
    $txt,
    'Free pickup within 1.5 km. Additional fee applies if driver is farther.' +
    '<div className="mt-1 text-[11px] text-slate-500">' +
    'Why this fee? Longer pickup distance means extra fuel and time for the driver.' +
    '</div>',
    1
  )
  Ok "[OK] Added 'Why this fee?' helper text"
} else {
  Info "[WARN] Pickup Distance Fee subtext anchor not found (non-fatal)"
}

# ---------- 3) Improve post-reject waiting copy ----------
# Anchor: result message for rejection
$reRejectMsg = [regex]::new(
  'Fare rejected\. Requesting another driver quote\.\.\.',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

if ($reRejectMsg.IsMatch($txt)) {
  $txt = $reRejectMsg.Replace(
    $txt,
    'Fare rejected. Looking for another nearby driver to give you a quote...',
    1
  )
  Ok "[OK] Improved reject waiting copy"
} else {
  Info "[WARN] Reject copy anchor not found (non-fatal)"
}

# ---------- Write ----------
[System.IO.File]::WriteAllText($Target, $txt, $Utf8NoBom)
Ok "[OK] Patched: app/ride/page.tsx"
Ok "DONE. Next: run build."
