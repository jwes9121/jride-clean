# PATCH-JRIDE_PASSENGER_UX_P7A_DASHBOARD_STEPPER_AND_GATING.ps1
# P7A: Passenger Dashboard UX polish (UI-only)
# - Add "What happens next" stepper (non-functional UX guidance)
# - Improve guest gating messaging (no redirects except on action)
# - Fix mojibake "â€¦" -> "..."
# HARD RULES: ANCHOR_BASED_ONLY, NO_DECLARE, NO_REDECLARE, DO_NOT_TOUCH_DISPATCH_STATUS
# ASCII-only

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$file = Join-Path $root "app\passenger\page.tsx"
if(!(Test-Path $file)){ Fail "File not found: $file" }

$txt = Get-Content -LiteralPath $file -Raw -Encoding UTF8

# --- 0) Mojibake cleanup (safe)
$txt2 = $txt
$txt2 = $txt2.Replace("â€¦", "...")
if($txt2 -ne $txt){
  $txt = $txt2
}

# --- 1) Insert a small guest hint under the status pill
# Anchor: the status pill div
$pillAnchor = '<div className="text-xs rounded-full border border-black/10 px-3 py-1">'
if($txt.IndexOf($pillAnchor) -lt 0){ Fail "Anchor not found: status pill div" }

# Guard: do not double-add
if($txt -match "P7A_GUEST_HINT"){
  Fail "P7A already applied (found P7A_GUEST_HINT). Aborting."
}

$guestHint = @"
<div className="mt-2 text-xs">
  {/* P7A_GUEST_HINT */}
  {!authed ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
      <div className="font-semibold">Sign in required</div>
      <div className="opacity-80">To book a ride, takeout, or errand, please sign in first.</div>
    </div>
  ) : null}
</div>
"@

# Insert right after the pill block closes (we anchor on the exact pill open + its closing </div></div> area is variable),
# so we insert after the next occurrence of the pill closing tag line by finding the first "</div>" after the anchor line.
# Safer: inject right AFTER the entire pill element in the header row by replacing the pill closing with itself + hint.
$txt = [regex]::Replace(
  $txt,
  '(?s)(' + [regex]::Escape($pillAnchor) + '.*?</div>\s*</div>)',
  '$1' + "`r`n`r`n" + $guestHint,
  1
)

# --- 2) Add "What happens next" stepper block under the 3 cards, before the buttons
# Anchor: cards grid
$cardsAnchor = '<div className="grid grid-cols-1 md:grid-cols-3 gap-3">'
if($txt.IndexOf($cardsAnchor) -lt 0){ Fail "Anchor not found: cards grid" }

# We insert after the grid's closing </div> which is followed by the buttons container: <div className="mt-5 flex gap-3">
$txt = [regex]::Replace(
  $txt,
  '(?s)(<div className="grid grid-cols-1 md:grid-cols-3 gap-3">.*?</div>)(\s*<div className="mt-5 flex gap-3">)',
  {
    param($m)
    $grid = $m.Groups[1].Value
    $next = $m.Groups[2].Value
    $stepper = @"
$grid

{/* P7A_STEPPER */}
<div className="mt-5 rounded-2xl border border-black/10 bg-white p-4">
  <div className="flex items-start justify-between gap-3">
    <div>
      <div className="text-sm font-semibold">What happens next</div>
      <div className="text-xs opacity-70">A quick guide so the flow feels predictable.</div>
    </div>
    <div className="text-[11px] rounded-full border border-black/10 px-2 py-1 opacity-70">Passenger UX</div>
  </div>

  <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs font-semibold">1) Choose</div>
      <div className="text-xs opacity-70 mt-1">Pick Ride, Takeout, or Errand.</div>
    </div>
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs font-semibold">2) Confirm</div>
      <div className="text-xs opacity-70 mt-1">Review pickup fee + platform fee.</div>
    </div>
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs font-semibold">3) Match</div>
      <div className="text-xs opacity-70 mt-1">We look for the nearest available driver.</div>
    </div>
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs font-semibold">4) Track</div>
      <div className="text-xs opacity-70 mt-1">See driver status until completion.</div>
    </div>
  </div>
</div>
"@
    return $stepper + $next
  },
  1
)

# --- 3) Improve the Continue button copy/tooltip slightly (no logic changes)
# Anchor: the title string "Loading session..."
if($txt.IndexOf('Loading session...') -lt 0){
  # If not found, don't fail; keep UI stable.
  # But we can still ensure the button label uses "Loading..." after mojibake cleanup.
} else {
  $txt = $txt.Replace('Loading session...', 'Loading session...')
}

# Backup + write
$bak = "$file.bak.$(Stamp)"
Copy-Item -LiteralPath $file -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

Set-Content -LiteralPath $file -Value $txt -Encoding UTF8
Write-Host "[OK] Patched: $file"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) Visit /passenger and confirm: stepper shows, Guest hint shows only when signed out"
