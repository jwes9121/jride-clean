# PATCH-JRIDE_P6J_LITE_LOCK_VERIFIED_FARE_UI_ONLY.ps1
# P6J-LITE: UI-only lock when verified fare exists (no hooks, no unlock)
# HARD RULES: ANCHOR_BASED_ONLY, DO_NOT_TOUCH_DISPATCH_STATUS
# ASCII-only

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$uiFile = Join-Path $root 'app\admin\livetrips\LiveTripsClient.tsx'
if(!(Test-Path $uiFile)){ Fail ('UI file not found: ' + $uiFile) }

$ui = Get-Content -LiteralPath $uiFile -Raw -Encoding UTF8

if($ui.IndexOf('selectedTrip') -lt 0){ Fail 'Anchor not found: selectedTrip' }
if($ui.IndexOf('proposedFareDraft') -lt 0){ Fail 'Anchor not found: proposedFareDraft' }

# Prevent double patch
if($ui.IndexOf('P6J_LITE_LOCK_VERIFIED_FARE') -ge 0){
  Fail 'P6J-LITE already applied. Aborting.'
}

# Backup
$bak = "$uiFile.bak.$(Stamp)"
Copy-Item -LiteralPath $uiFile -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

# Inline lock expression (no hooks)
$lockExpr = @'
{(() => {
  const v = (selectedTrip as any)?.verified_fare ?? (selectedTrip as any)?.verifiedFare ?? null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
})()}
'@.Trim()

# 1) Disable draft input (insert before value={proposedFareDraft})
$needleInput = 'value={proposedFareDraft}'
$posInput = $ui.IndexOf($needleInput)
if($posInput -lt 0){ Fail 'Anchor not found: value={proposedFareDraft}' }

$injectInput = @"
      {/* P6J_LITE_LOCK_VERIFIED_FARE */}
      disabled=$lockExpr
      readOnly=$lockExpr

"@

$ui2 = $ui.Substring(0, $posInput) + $injectInput + $ui.Substring($posInput)

# 2) Locate Apply Draft button opening tag
# Prefer apply-fare fetch anchor (most reliable). If missing, fallback to "Apply Draft" text.
$posFetch = $ui2.IndexOf('apply-fare')
$posRef = $posFetch
if($posRef -lt 0){
  $posRef = $ui2.IndexOf('Apply Draft')
  if($posRef -lt 0){ Fail 'Anchor not found: apply-fare or Apply Draft' }
}

$posBtn = $ui2.LastIndexOf('<button', $posRef)
if($posBtn -lt 0){ Fail 'Could not locate <button> start near Apply Draft' }

$posTagEnd = $ui2.IndexOf('>', $posBtn)
if($posTagEnd -lt 0){ Fail 'Could not locate end of Apply Draft <button ...> tag' }

$btnOpen = $ui2.Substring($posBtn, $posTagEnd - $posBtn + 1)

# If disabled already exists, leave it alone (do NOT try to rewrite)
# Otherwise inject disabled lock before '>'
if($btnOpen.IndexOf('disabled=') -lt 0){
  $btnOpen = $btnOpen.Substring(0, $btnOpen.Length - 1) + " disabled=$lockExpr title=`"Fare locked when verified fare exists`">"
}

$ui3 = $ui2.Substring(0, $posBtn) + $btnOpen + $ui2.Substring($posTagEnd + 1)

# 3) Insert lock note right after the Apply Draft </button> close (closest after reference point)
$posClose = $ui3.IndexOf('</button>', $posRef)
if($posClose -lt 0){
  # fallback: search from button start
  $posClose = $ui3.IndexOf('</button>', $posBtn)
}
if($posClose -lt 0){ Fail 'Could not find </button> closing near Apply Draft' }

$insertAfter = $posClose + 9

$note = @'
      {(() => {
        const v = (selectedTrip as any)?.verified_fare ?? (selectedTrip as any)?.verifiedFare ?? null;
        const n = Number(v);
        const locked = Number.isFinite(n) && n > 0;
        return locked ? (
          <div className="mt-2 text-[11px] font-semibold text-amber-700">
            Fare locked (verified). Editing disabled.
          </div>
        ) : null;
      })()}
'@.TrimEnd()

$ui4 = $ui3.Substring(0, $insertAfter) + "`r`n`r`n" + $note + "`r`n" + $ui3.Substring($insertAfter)

Set-Content -LiteralPath $uiFile -Value $ui4 -Encoding UTF8
Write-Host "[OK] Patched: $uiFile"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) Select trip with verified fare -> draft/apply disabled + note shown"
