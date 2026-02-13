# DEBUG-JRIDE_P8_PICKUP_FEE_DISCLOSURE_PANEL_V1.ps1
# ASCII-only. UI_ONLY_PASSENGER. ANCHOR_INSERT_ONLY. UTF8_NO_BOM. NO_MOJIBAKE.
# Adds a debug panel visible only on /ride?p8debug=1, then runs build and opens the page.

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
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target. Run from repo root." }

$ts = Timestamp
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = ReadText $target

# Verify P8 exists
if($txt -notmatch "JRIDE_P8_PICKUP_FEE_DISCLOSURE_BEGIN"){
  Fail "P8 banner markers not found. Make sure the P8 patch was applied before running this debug script."
}

if($txt -match "JRIDE_P8_DEBUG_PANEL_BEGIN"){
  Write-Host "[SKIP] P8 debug panel already present."
} else {
  # Anchor: insert right after the P8 banner end marker, inside the P7B fare breakdown return block.
  $anchor = "JRIDE_P8_PICKUP_FEE_DISCLOSURE_END"
  $idx = $txt.IndexOf($anchor)
  if($idx -lt 0){ Fail "ANCHOR NOT FOUND: JRIDE_P8_PICKUP_FEE_DISCLOSURE_END" }

  # Insert immediately after the end marker comment block line.
  # We locate the end of that comment line by finding the next newline.
  $nl = $txt.IndexOf("`n", $idx)
  if($nl -lt 0){ Fail "Could not locate newline after P8 end marker." }
  $insertPos = $nl + 1

  $debugBlock = @'
    {/* ===== JRIDE_P8_DEBUG_PANEL_BEGIN (dev-only) ===== */}
    {(() => {
      // Show only if URL has ?p8debug=1
      const dbg =
        (typeof window !== "undefined") &&
        (new URLSearchParams(window.location.search).get("p8debug") === "1");

      if (!dbg) return null;

      const kmNum = Number(kmAny);
      const kmOk = Number.isFinite(kmNum);
      const kmDisp = kmOk ? (Math.round(kmNum * 100) / 100).toFixed(2) : "--";

      const feeNum = Number(pickupFee || 0);
      const feeOk = Number.isFinite(feeNum);

      const offerNum = Number(offerAny);
      const offerOk = Number.isFinite(offerNum);

      return (
        <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs">
          <div className="font-semibold">P8 Debug panel (remove before prod)</div>
          <div className="mt-1 font-mono">
            kmAny: {String(kmAny)} | kmNum: {kmDisp} | showPickupFee: {String(showPickupFee)}
          </div>
          <div className="mt-1 font-mono">
            pickupFee: {String(pickupFee)} | feeNum: {feeOk ? String(feeNum) : "NaN"} | feeMoney: {p4Money(feeNum)}
          </div>
          <div className="mt-1 font-mono">
            offerAny: {String(offerAny)} | offerNum: {offerOk ? String(offerNum) : "NaN"}
          </div>
        </div>
      );
    })()}
    {/* ===== JRIDE_P8_DEBUG_PANEL_END ===== */}

'@

  $txt = $txt.Substring(0, $insertPos) + $debugBlock + $txt.Substring($insertPos)
  Write-Host "[OK] Inserted P8 debug panel (visible only on /ride?p8debug=1)."

  # Safety cleanup (no mojibake)
  $txt = $txt.Replace("â€¦", "...")
}

WriteUtf8NoBom $target $txt
Write-Host "[OK] Wrote: $target"

Write-Host ""
Write-Host "Running build..."
& npm.cmd run build

Write-Host ""
Write-Host "[OK] If build is green, open this URL while dev server is running:"
Write-Host "  http://localhost:3000/ride?p8debug=1"

try {
  Start-Process "http://localhost:3000/ride?p8debug=1" | Out-Null
  Write-Host "[OK] Opened browser."
} catch {
  Write-Host "[WARN] Could not auto-open browser. Manually open:"
  Write-Host "  http://localhost:3000/ride?p8debug=1"
}
