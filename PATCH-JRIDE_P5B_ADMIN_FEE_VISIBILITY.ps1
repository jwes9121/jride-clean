# PATCH-JRIDE_P5B_ADMIN_FEE_VISIBILITY.ps1
# P5B: Admin/Dispatcher fee visibility (read-only)
# - Add Passenger Charges breakdown to TripWalletPanel
# - Ensure LiveTrips page-data API selects proposed_fare, verified_fare, pickup_distance_fee, platform_service_fee, total_to_pay
# Anchor-based edits only.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$ROOT = (Get-Location).Path

$Panel = Join-Path $ROOT 'app\admin\livetrips\components\TripWalletPanel.tsx'
$PageData = Join-Path $ROOT 'app\api\admin\livetrips\page-data\route.ts'

if (!(Test-Path $Panel)) { Fail "Missing file: $Panel" }
if (!(Test-Path $PageData)) { Fail "Missing file: $PageData" }

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ------------------- Backup files -------------------
$ts = (Get-Date).ToString('yyyyMMdd_HHmmss')

Copy-Item $Panel ($Panel + ".bak." + $ts) -Force
Ok "[OK] Backup: $Panel.bak.$ts"

Copy-Item $PageData ($PageData + ".bak." + $ts) -Force
Ok "[OK] Backup: $PageData.bak.$ts"

# =================== 1) TripWalletPanel: add Passenger Charges ===================
$txt = Get-Content -LiteralPath $Panel -Raw

# Idempotency
if ($txt -match 'JRIDE_P5B_PASSENGER_CHARGES_BLOCK') {
  Info "[SKIP] TripWalletPanel already patched (JRIDE_P5B_PASSENGER_CHARGES_BLOCK)."
} else {

  # ---- Insert computed fields after driverPayout useMemo block (anchor) ----
  $anchorCalc = 'const driverPayout = useMemo\(\(\) => \{[\s\S]*?\}\s*,\s*\[trip\]\s*\);'
  $reCalc = [regex]::new($anchorCalc, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $mCalc = $reCalc.Match($txt)
  if (-not $mCalc.Success) { Fail "Anchor not found in TripWalletPanel.tsx: driverPayout useMemo block." }

  $injectCalc = @"

  // ===== JRIDE_P5B_PASSENGER_CHARGES_BLOCK (computed, read-only) =====
  // Passenger-facing fees (if present on trip row)
  const passengerPickupFee = useMemo(() => {
    return asNum(trip?.pickup_distance_fee ?? trip?.pickupDistanceFee ?? trip?.pickup_fee ?? null);
  }, [trip]);

  const passengerPlatformFee = useMemo(() => {
    // Keep separate from company_cut; passenger platform fee should be explicit (e.g., platform_service_fee)
    return asNum(trip?.platform_service_fee ?? trip?.platformServiceFee ?? trip?.platform_service ?? null);
  }, [trip]);

  const passengerBaseFare = useMemo(() => {
    const v = asNum(trip?.verified_fare);
    if (v !== null) return v;
    const p = asNum(trip?.proposed_fare);
    if (p !== null) return p;
    // fallback to fareDisplay (already computed above)
    return asNum(fareDisplay);
  }, [trip, fareDisplay]);

  const passengerTotalToPay = useMemo(() => {
    const explicit =
      asNum(trip?.total_to_pay ?? trip?.totalToPay ?? trip?.passenger_total ?? trip?.passengerTotal ?? null);
    if (explicit !== null) return explicit;

    if (passengerBaseFare === null) return null;
    const pu = passengerPickupFee ?? 0;
    const pf = passengerPlatformFee ?? 0;
    return Math.round((passengerBaseFare + pu + pf) * 100) / 100;
  }, [trip, passengerBaseFare, passengerPickupFee, passengerPlatformFee]);

  const showPassengerCharges = useMemo(() => {
    if (isTakeout) return false;
    const hasAny =
      asNum(trip?.verified_fare) !== null ||
      asNum(trip?.proposed_fare) !== null ||
      passengerPickupFee !== null ||
      passengerPlatformFee !== null ||
      asNum(trip?.total_to_pay ?? trip?.totalToPay ?? null) !== null;
    return !!hasAny;
  }, [trip, isTakeout, passengerPickupFee, passengerPlatformFee]);
  // ===== END JRIDE_P5B_PASSENGER_CHARGES_BLOCK =====

"@

  $txt = $txt.Substring(0, $mCalc.Index + $mCalc.Length) + $injectCalc + $txt.Substring($mCalc.Index + $mCalc.Length)
  Ok "[OK] TripWalletPanel: inserted passenger fee computed fields"

  # ---- Insert UI block above Vendor wallet card (anchor on the vendor wallet card div) ----
  $vendorAnchor = '<div className="rounded border bg-white p-2 col-span-2">\s*<div className="text-slate-500">Vendor wallet</div>'
  $reVendor = [regex]::new($vendorAnchor, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $reVendor.IsMatch($txt)) { Fail "Anchor not found in TripWalletPanel.tsx: Vendor wallet card block." }

  $passengerCard = @"
        {showPassengerCharges && (
          <div className="rounded border bg-white p-2 col-span-2">
            <div className="flex items-center justify-between">
              <div className="text-slate-500">Passenger charges (read-only)</div>
              <div className="text-[11px] text-slate-400">P5B</div>
            </div>

            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-slate-600">Fare (offer/verified)</div>
                <div className="font-semibold">{fmtMoney(passengerBaseFare)}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-slate-600">Pickup Distance Fee</div>
                <div className={"font-semibold " + ((passengerPickupFee ?? 0) > 0 ? "text-amber-700" : "")}>
                  {fmtMoney(passengerPickupFee)}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-slate-600">Platform Service Fee</div>
                <div className="font-semibold">{fmtMoney(passengerPlatformFee)}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-slate-900 font-semibold">Total to Pay</div>
                <div className="text-slate-900 font-bold">{fmtMoney(passengerTotalToPay)}</div>
              </div>
            </div>

            <div className="mt-2 text-[11px] text-slate-500">
              This section mirrors passenger-facing line items when those fields are present on the booking.
            </div>
          </div>
        )}

"@

  # Replace first vendor wallet card opening with passenger card + original vendor opening (preserve original)
  $txt = $reVendor.Replace($txt, $passengerCard + '$0', 1)
  Ok "[OK] TripWalletPanel: added Passenger charges UI block"
}

[System.IO.File]::WriteAllText($Panel, $txt, $Utf8NoBom)
Ok "[OK] Patched: app/admin/livetrips/components/TripWalletPanel.tsx"

# =================== 2) page-data route: ensure select includes fields ===================
$api = Get-Content -LiteralPath $PageData -Raw

# We only patch if we can find a bookings select("...") string literal.
# Anchor: .from("bookings") followed by .select("...")
$reSelect = [regex]::new('(?s)\.from\(\s*["'']bookings["'']\s*\)\s*\.select\(\s*["'']([^"'']+)["'']\s*\)')
$mSel = $reSelect.Match($api)
if (-not $mSel.Success) {
  Fail "Anchor not found in page-data route: .from('bookings').select(\"...\")"
}

$sel = $mSel.Groups[1].Value

# Add missing fields (no duplicates)
$need = @('proposed_fare','verified_fare','pickup_distance_fee','platform_service_fee','total_to_pay')
foreach ($f in $need) {
  if ($sel -notmatch ("(^|,)\s*" + [regex]::Escape($f) + "\s*(,|$)")) {
    $sel = $sel.TrimEnd() + ", " + $f
  }
}

$api2 = $api.Substring(0, $mSel.Index) +
  $api.Substring($mSel.Index, $mSel.Length).Replace($mSel.Groups[1].Value, $sel) +
  $api.Substring($mSel.Index + $mSel.Length)

[System.IO.File]::WriteAllText($PageData, $api2, $Utf8NoBom)
Ok "[OK] Patched: app/api/admin/livetrips/page-data/route.ts (bookings select fields ensured)"

Ok "DONE. Next: run build."
