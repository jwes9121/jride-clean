# PATCH-JRIDE_P7B_PASSENGER_FARE_BREAKDOWN_ASCII_SAFE_V2.ps1
# ASCII-only. Anchor-based only (regex). UI-only passenger. UTF8 NO BOM. No dispatch status changes.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

function Timestamp() {
  return (Get-Date).ToString("yyyyMMdd_HHmmss")
}

function ReadText($path) {
  if (!(Test-Path -LiteralPath $path)) { Fail "Missing file: $path" }
  return [System.IO.File]::ReadAllText($path)
}

function WriteUtf8NoBom($path, $text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"

if (!(Test-Path -LiteralPath $target)) {
  Fail "Target not found: $target`nRun this script from your repo root."
}

$ts = Timestamp
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = ReadText $target

# ------------------------------------------------------------
# 1) Mojibake cleanup (ASCII-only replacements)
# ------------------------------------------------------------
$orig = $txt

# Known mojibake dash placeholder -> ASCII
$txt = $txt.Replace("Ã¢â‚¬"", "--")

# Known mojibake peso prefix -> ASCII
$txt = $txt.Replace("Ã¢â€š±", "PHP ")

# Known mojibake ellipsis token -> ASCII
$txt = $txt.Replace("â€¦", "...")

# Clean the big mojibake comment inside p1IsNonCancellable (if present)
$txt = [Regex]::Replace(
  $txt,
  '(?m)^\s*//\s*UI-only guardrail: no.*$',
  '    // UI-only guardrail: no cancel/clear once driver is already on the way or later'
)

if ($txt -ne $orig) {
  Write-Host "[OK] Mojibake cleanup applied (ASCII-safe)."
} else {
  Write-Host "[OK] Mojibake cleanup: no changes needed."
}

# ------------------------------------------------------------
# 2) Inject P7B Fare Breakdown UI (anchor-based: regex)
#    Insert right after the code block line inside Trip status (live) card.
# ------------------------------------------------------------
if ($txt -match "JRIDE_P7B_FARE_BREAKDOWN_BEGIN") {
  Write-Host "[SKIP] P7B block already present."
} else {

  # Regex anchor: the 'code:' div block (allow whitespace / formatting differences)
  $pattern = '(?s)<div\s+className\s*=\s*"mt-1\s+text-xs\s+font-mono"\s*>\s*code:\s*<span\s+className\s*=\s*"font-semibold"\s*>\s*\{\s*activeCode\s*\}\s*</span>\s*</div>'

  $m = [Regex]::Match($txt, $pattern)
  if (!$m.Success) {
    Fail "ANCHOR NOT FOUND for P7B injection. No changes applied. Could not locate the 'code:' block within Trip status (live)."
  }

  $insert = @'
            <div className="mt-4 rounded-2xl border border-black/10 bg-white p-3">
              {/* ===== JRIDE_P7B_FARE_BREAKDOWN_BEGIN (UI-only) ===== */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Fare breakdown</div>
                  <div className="text-xs opacity-70">
                    Driver offer + pickup distance fee + platform fee.
                  </div>
                </div>
                <div className="text-xs rounded-full bg-black/5 px-3 py-1 font-semibold">
                  ESTIMATE
                </div>
              </div>

              {(() => {
                // UI-only. Best-effort field picks. No backend assumptions.
                const b: any = (typeof liveBooking !== "undefined") ? (liveBooking as any) : null;

                const offerAny: any = b ? (
                  b.driver_fare_offer ??
                  b.fare_offer ??
                  b.driver_offer_fare ??
                  b.driver_fare ??
                  b.fare ??
                  b.quoted_fare ??
                  b.proposed_fare ??
                  b.fare_amount ??
                  b.amount ??
                  null
                ) : null;

                const kmAny: any = b ? (
                  b.driver_to_pickup_km ??
                  b.driver_pickup_km ??
                  b.pickup_distance_km ??
                  b.pickup_km ??
                  b.driver_distance_km ??
                  b.distance_driver_to_pickup_km ??
                  null
                ) : null;

                const offerNum = Number(offerAny);
                const hasOffer = Number.isFinite(offerNum) && offerNum >= 0;

                const pickupFee = p4PickupDistanceFee(kmAny);
                const platformFee = Number(P4_PLATFORM_SERVICE_FEE) || 0;

                const total =
                  (hasOffer ? offerNum : 0) +
                  (Number.isFinite(Number(pickupFee)) ? Number(pickupFee) : 0) +
                  platformFee;

                const showPickupFee = Number(pickupFee || 0) > 0;

                return (
                  <div className="mt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Driver offer</div>
                        <div className="font-mono text-sm">
                          {hasOffer ? p4Money(offerNum) : "--"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Pickup distance fee</div>
                        <div className="font-mono text-sm">
                          {showPickupFee ? p4Money(pickupFee) : "PHP 0"}
                        </div>
                        <div className="mt-1 text-[11px] opacity-70">
                          Free up to 1.5 km. Base PHP 20 then PHP 10 per additional 0.5 km (rounded up).
                        </div>
                      </div>

                      <div className="rounded-xl border border-black/10 p-2">
                        <div className="text-xs opacity-70">Platform fee</div>
                        <div className="font-mono text-sm">{p4Money(platformFee)}</div>
                        <div className="mt-1 text-[11px] opacity-70">
                          Convenience / service fee
                        </div>
                      </div>

                      <div className="rounded-xl border border-black/10 p-2 bg-black/5">
                        <div className="text-xs opacity-70">Estimated total</div>
                        <div className="font-mono text-sm font-semibold">
                          {hasOffer ? p4Money(total) : "--"}
                        </div>
                        <div className="mt-1 text-[11px] opacity-70">
                          Total updates once a driver quote exists.
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {/* ===== JRIDE_P7B_FARE_BREAKDOWN_END ===== */}
            </div>
'@

  $pos = $m.Index + $m.Length
  $txt = $txt.Substring(0, $pos) + "`r`n" + $insert + $txt.Substring($pos)

  Write-Host "[OK] Inserted P7B Fare Breakdown block (regex anchor)."
}

# Final write (UTF8 no BOM)
WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
