# PATCH-JRIDE_P8_PICKUP_FEE_DISCLOSURE_BANNER_V1.ps1
# ASCII-only. UI_ONLY_PASSENGER. ANCHOR_BASED_ONLY. INSERT-ONLY.
# NO_REDECLARE_NO_DECLARE (no new top-level vars). UTF8_NO_BOM. NO_MOJIBAKE.
# DO NOT TOUCH DISPATCH/APIS.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Timestamp(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }

function ReadText($path){
  if(!(Test-Path -LiteralPath $path)){ Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path)
}
function WriteUtf8NoBom($path,$text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path,$text,$enc)
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target`nRun from repo root." }

$ts = Timestamp
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = ReadText $target
$orig = $txt

if($txt -notmatch "JRIDE_P7B_FARE_BREAKDOWN_BEGIN"){
  Fail "ANCHOR NOT FOUND: JRIDE_P7B_FARE_BREAKDOWN_BEGIN not found. No changes applied."
}

if($txt -match "JRIDE_P8_PICKUP_FEE_DISCLOSURE_BEGIN"){
  Write-Host "[SKIP] P8 pickup fee disclosure banner already present."
} else {

  # Anchor: inside the fare breakdown IIFE return, immediately after: <div className="mt-3">
  # We only replace the FIRST occurrence AFTER the P7B BEGIN marker to avoid touching other mt-3 blocks.
  $idx = $txt.IndexOf("JRIDE_P7B_FARE_BREAKDOWN_BEGIN")
  if($idx -lt 0){ Fail "Unexpected: could not find P7B begin index." }

  $tail = $txt.Substring($idx)
  $pattern = '(?s)return\s*\(\s*<div\s+className="mt-3">\s*'
  $m = [Regex]::Match($tail, $pattern)
  if(!$m.Success){
    Fail 'ANCHOR NOT FOUND: Could not locate "return (<div className=""mt-3"">" inside P7B fare breakdown.'
  }

  $insert = @'
return (
  <div className="mt-3">
    {/* ===== JRIDE_P8_PICKUP_FEE_DISCLOSURE_BEGIN (UI-only) ===== */}
    {(() => {
      // Use existing vars in this closure: kmAny, pickupFee, showPickupFee, p4Money
      const kmNum = Number(kmAny);
      const kmOk = Number.isFinite(kmNum);
      const kmDisp = kmOk ? (Math.round(kmNum * 100) / 100).toFixed(2) : "--";
      const fee = Number(pickupFee || 0);

      if (!showPickupFee || !(fee > 0)) return null;

      return (
        <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="font-semibold text-amber-900">
            Pickup is far. Extra pickup distance fee applies.
          </div>
          <div className="mt-1 text-amber-900/80">
            Driver to pickup distance: <span className="font-mono">{kmDisp} km</span>
            {" "}• Extra fee: <span className="font-mono font-semibold">{p4Money(fee)}</span>
          </div>
          <div className="mt-1 text-[11px] text-amber-900/70">
            Free up to 1.5 km. Base PHP 20 then PHP 10 per additional 0.5 km (rounded up).
          </div>
        </div>
      );
    })()}
    {/* ===== JRIDE_P8_PICKUP_FEE_DISCLOSURE_END ===== */}
'@

  # Replace the matched "return (<div className="mt-3">" with our inserted header version.
  $tail2 = [Regex]::Replace($tail, $pattern, $insert, 1)
  $txt = $txt.Substring(0, $idx) + $tail2

  Write-Host "[OK] Inserted P8 pickup fee disclosure banner inside P7B fare breakdown."
}

# Safety: remove known mojibake token if present (no peso symbol insertion)
$txt = $txt.Replace("â€¦", "...")

if($txt -eq $orig){
  Fail "No changes made (unexpected). Aborting without write."
}

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
