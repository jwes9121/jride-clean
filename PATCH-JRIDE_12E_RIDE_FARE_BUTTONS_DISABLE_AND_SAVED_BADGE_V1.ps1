# PATCH-JRIDE_12E_RIDE_FARE_BUTTONS_DISABLE_AND_SAVED_BADGE_V1.ps1
# ASCII-only | UTF8 NO BOM
# UI-only: disable/hide fare buttons after response + show Saved badge.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function TS(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadT($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object Text.UTF8Encoding($false); [IO.File]::WriteAllText($p,$t,$enc) }

$target = "app\ride\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

$bak = "$target.bak.$(TS)"
Copy-Item -Force $target $bak
Write-Host "[OK] Backup: $bak"

$txt = ReadT $target
$orig = $txt

# Anchor: Passenger response container
$anchor = '<div className="mt-2 text-sm">'
$pos = $txt.IndexOf($anchor)
if($pos -lt 0){ Fail "ANCHOR NOT FOUND: Passenger response container not found." }

# Avoid double insert
if($txt -match 'Saved:\s*accepted|Saved:\s*rejected'){
  Write-Host "[OK] Saved badge already present (skipped)."
} else {

$badge = @'
  {(() => {
    const resp = String(((liveBooking as any)?.passenger_fare_response ?? "")).toLowerCase();
    if (resp === "accepted" || resp === "rejected") {
      return (
        <div className="mt-2 inline-flex items-center rounded-full border border-black/10 px-2 py-0.5 text-xs">
          Saved: <span className="ml-1 font-medium">{resp}</span>
        </div>
      );
    }
    return null;
  })()}
'@

  # Insert badge right after Passenger response block opening
  $insertAt = $pos + $anchor.Length
  $txt = $txt.Substring(0,$insertAt) + "`r`n" + $badge + $txt.Substring($insertAt)
  Write-Host "[OK] Inserted Saved badge under Passenger response."
}

# Disable/hide buttons: wrap existing button block guard
# Replace the canAct logic to ensure buttons only render when pending
$txt = [regex]::Replace(
  $txt,
  'const\s+pending\s*=\s*!resp\s*\|\|\s*resp\s*===\s*"pending";\s*const\s+canAct\s*=\s*pending\s*&&\s*\(liveBooking\s+as\s+any\)\?\.verified_fare\s*!=\s*null;',
  'const pending = (!resp || resp === "pending"); const canAct = pending && (liveBooking as any)?.verified_fare != null;',
  'Singleline'
)

# Ensure buttons are hidden when not pending
$txt = [regex]::Replace(
  $txt,
  'if\s*\(!canAct\)\s*return\s*null;',
  'if (!canAct) return null;',
  'Singleline'
)

if($txt -eq $orig){ Fail "No changes applied." }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
