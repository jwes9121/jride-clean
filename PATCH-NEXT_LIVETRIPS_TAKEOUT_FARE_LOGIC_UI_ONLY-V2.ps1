# C:\Users\jwes9\Desktop\jride-clean-fresh\PATCH-NEXT_LIVETRIPS_TAKEOUT_FARE_LOGIC_UI_ONLY-V2.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $repo "app\admin\livetrips\components\TripWalletPanel.tsx"
if (!(Test-Path $file)) { Fail "Target not found: $file" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $file "$file.bak.$stamp" -Force
Write-Host "[OK] Backup created" -ForegroundColor Green

$txt = Get-Content $file -Raw

# Sanity: file must contain these exact lines (from your current TripWalletPanel)
$fareLine = "const fare = useMemo(() => computeFareFromBooking(trip), [trip]);"
$ccLine   = "const companyCut = useMemo(() => trip?.company_cut ?? null, [trip]);"
$dpLine   = "const driverPayout = useMemo(() => trip?.driver_payout ?? null, [trip]);"

if ($txt -notmatch [regex]::Escape($fareLine)) { Fail "Did not find expected fare memo line. Paste the memo section from TripWalletPanel.tsx." }
if ($txt -notmatch [regex]::Escape($ccLine))   { Fail "Did not find expected companyCut memo line. Paste the memo section from TripWalletPanel.tsx." }
if ($txt -notmatch [regex]::Escape($dpLine))   { Fail "Did not find expected driverPayout memo line. Paste the memo section from TripWalletPanel.tsx." }

# 1) Insert isTakeoutTrip helper (only once), right before computeFareFromBooking
if ($txt -match "function\s+isTakeoutTrip\s*\(") {
  Write-Host "[INFO] isTakeoutTrip already exists; skipping helper insert." -ForegroundColor Yellow
} else {
  $needle = "function computeFareFromBooking(trip: any): number | null {"
  $idx = $txt.IndexOf($needle)
  if ($idx -lt 0) { Fail "Could not find computeFareFromBooking(...) function." }

  $helper = @"

function isTakeoutTrip(trip: any): boolean {
  if (!trip) return false;
  const tt = String(trip?.trip_type ?? trip?.tripType ?? "").trim().toLowerCase();
  if (tt === "takeout") return true;
  const code = String(trip?.booking_code ?? trip?.bookingCode ?? "").trim().toUpperCase();
  return code.startsWith("TAKEOUT-") || code.startsWith("TAKEOUT_") || code.startsWith("TAKEOUT");
}

"@

  $txt = $txt.Substring(0, $idx) + $helper + $txt.Substring($idx)
  Write-Host "[OK] Inserted isTakeoutTrip()" -ForegroundColor Green
}

# 2) Expand computeFareFromBooking by inserting TAKEOUT-friendly fields near the top
$fnNeedle = "function computeFareFromBooking(trip: any): number | null {"
$fnPos = $txt.IndexOf($fnNeedle)
if ($fnPos -lt 0) { Fail "computeFareFromBooking needle not found after helper step." }

# Ensure we don't double-insert
if ($txt -match "TAKEOUT fare fields") {
  Write-Host "[INFO] computeFareFromBooking already has TAKEOUT fare fields; skipping insert." -ForegroundColor Yellow
} else {
  $insertAfter = $fnPos + $fnNeedle.Length
  $fareInsert = @"
  // TAKEOUT fare fields (read-only display; do NOT assume schema)
  const direct = asNum(trip?.fare);
  if (direct !== null) return direct;
  const totalFare = asNum(trip?.total_fare);
  if (totalFare !== null) return totalFare;
  const totalAmt = asNum(trip?.total_amount);
  if (totalAmt !== null) return totalAmt;
  const amount = asNum(trip?.amount);
  if (amount !== null) return amount;
  const orderTotal = asNum(trip?.order_total);
  if (orderTotal !== null) return orderTotal;
  const subtotal = asNum(trip?.subtotal);
  if (subtotal !== null) return subtotal;
  const deliveryFee = asNum(trip?.delivery_fee);
  if (deliveryFee !== null) return deliveryFee;

"@
  $txt = $txt.Substring(0, $insertAfter) + "`r`n" + $fareInsert + $txt.Substring($insertAfter)
  Write-Host "[OK] Expanded computeFareFromBooking() with TAKEOUT fare fields" -ForegroundColor Green
}

# 3) Add isTakeout memo right after fare memo line
$isTakeoutMemo = "const isTakeout = useMemo(() => isTakeoutTrip(trip), [trip]);"
if ($txt -match [regex]::Escape($isTakeoutMemo)) {
  Write-Host "[INFO] isTakeout memo already present; skipping." -ForegroundColor Yellow
} else {
  $txt = $txt.Replace($fareLine, $fareLine + "`r`n  " + $isTakeoutMemo)
  Write-Host "[OK] Added isTakeout memo" -ForegroundColor Green
}

# 4) Replace companyCut memo with safe fallback + 10% for TAKEOUT when explicit is missing
$newCompanyCut = @"
const companyCut = useMemo(() => {
    const explicit = asNum(trip?.company_cut ?? trip?.platform_fee ?? trip?.commission ?? trip?.company_fee);
    if (explicit !== null) return explicit;
    if (isTakeout && fare !== null) return Math.round(fare * 0.10 * 100) / 100;
    return null;
  }, [trip, isTakeout, fare]);
"@
$txt = $txt.Replace($ccLine, $newCompanyCut.TrimEnd())

# 5) Replace driverPayout memo with explicit-only fallbacks (no guessing)
$newDriverPayout = @"
const driverPayout = useMemo(() => {
    const explicit = asNum(trip?.driver_payout ?? trip?.driver_fee ?? trip?.driver_earnings ?? trip?.driver_cut);
    if (explicit !== null) return explicit;
    return null;
  }, [trip]);
"@
$txt = $txt.Replace($dpLine, $newDriverPayout.TrimEnd())

# Final sanity
if ($txt -notmatch "function isTakeoutTrip") { Fail "Sanity failed: isTakeoutTrip missing after patch." }
if ($txt -notmatch "TAKEOUT fare fields")    { Fail "Sanity failed: fare insert missing after patch." }
if ($txt -notmatch "Math\.round\(fare \* 0\.10") { Fail "Sanity failed: company cut 10% fallback missing." }

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[DONE] UI-only TAKEOUT fare/company-cut logic patched successfully." -ForegroundColor Green
Write-Host "Patched: $file" -ForegroundColor Green
