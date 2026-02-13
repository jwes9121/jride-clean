# PATCH-JRIDE_12D_RIDE_DRIVER_OFFER_VISIBILITY_UI_V1.ps1
# ASCII-only | UTF8 NO BOM
# UI-only: adds Driver Offer Status panel above Passenger response block.

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

# Anchor: existing Passenger response line using liveBooking
$anchor = 'Passenger response: <span className="font-medium">{(liveBooking as any)?.passenger_fare_response ?? "pending"}</span>'
$pos = $txt.IndexOf($anchor)
if($pos -lt 0){ Fail "ANCHOR NOT FOUND: Passenger response line not found." }

# Avoid double insert
if($txt -match 'Driver offer status'){
  Write-Host "[OK] Driver Offer Status already present (skipped)."
} else {
  # Insert panel just BEFORE the Passenger response container
  $insertAt = $txt.LastIndexOf('<div className="mt-2 text-sm">', $pos)
  if($insertAt -lt 0){ Fail "ANCHOR NOT FOUND: could not locate Passenger response container div." }

  $panel = @'
<div className="mt-3 rounded-xl border border-black/10 p-3">
  <div className="text-xs font-semibold opacity-70">Driver offer status</div>

  {(() => {
    const lb: any = (liveBooking as any) || null;
    const hasOffer = lb && lb.proposed_fare != null;
    const hasVerified = lb && lb.verified_fare != null;

    if (!hasOffer) {
      return <div className="mt-1 text-sm">Waiting for driver offer...</div>;
    }

    if (hasOffer && !hasVerified) {
      return (
        <div className="mt-1 text-sm">
          <div>Offer received – waiting verification</div>
          <div className="mt-1">
            Driver offer: <span className="font-medium">PHP {Number(lb.proposed_fare).toFixed(0)}</span>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-1 text-sm">
        <div>Verified fare ready</div>
        <div className="mt-1">
          Driver offer: <span className="font-medium">PHP {Number(lb.proposed_fare).toFixed(0)}</span>
        </div>
        <div className="mt-1">
          Verified fare: <span className="font-medium">PHP {Number(lb.verified_fare).toFixed(0)}</span>
        </div>
      </div>
    );
  })()}
</div>

'@

  $txt = $txt.Substring(0,$insertAt) + $panel + $txt.Substring($insertAt)
  Write-Host "[OK] Injected Driver Offer Status panel."
}

if($txt -eq $orig){ Fail "No changes applied." }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
