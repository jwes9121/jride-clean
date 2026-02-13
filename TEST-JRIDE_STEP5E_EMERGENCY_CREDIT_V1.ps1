# TEST-JRIDE_STEP5E_EMERGENCY_CREDIT_V1.ps1
$ErrorActionPreference = "Stop"

# -----------------------------
# Config
# -----------------------------
$BaseUrl = $env:JRIDE_BASEURL
if (-not $BaseUrl) { $BaseUrl = "http://localhost:3000" }

# Option A: provide booking id directly (recommended)
$BookingId = $env:JRIDE_BOOKING_ID

# Supabase service role key (required to query DB directly for verification)
# Set env var before running:
#   setx SUPABASE_SERVICE_ROLE_KEY "..."
$SupabaseUrl = $env:SUPABASE_URL
$ServiceKey  = $env:SUPABASE_SERVICE_ROLE_KEY

function Die($m){ Write-Host "[ERR] $m" -ForegroundColor Red; exit 1 }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

if (-not $SupabaseUrl) { Die "Missing env SUPABASE_URL" }
if (-not $ServiceKey)  { Die "Missing env SUPABASE_SERVICE_ROLE_KEY (needed to verify driver_wallet_transactions)" }

# -----------------------------
# Helper: REST call
# -----------------------------
function Invoke-JsonPost($url, $obj) {
  $json = ($obj | ConvertTo-Json -Depth 10)
  return Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $json
}

# -----------------------------
# Helper: query Supabase REST
# -----------------------------
function Sb-Get($path) {
  $h = @{
    "apikey"        = $ServiceKey
    "Authorization" = "Bearer $ServiceKey"
  }
  return Invoke-RestMethod -Method Get -Uri ($SupabaseUrl.TrimEnd("/") + $path) -Headers $h
}

# -----------------------------
# 0) If booking_id not provided, try to pick a recent emergency booking
# -----------------------------
if (-not $BookingId) {
  Info "No JRIDE_BOOKING_ID provided. Searching for a recent emergency booking..."
  # last 20 emergency bookings, newest first
  $q = "/rest/v1/bookings?select=id,booking_code,is_emergency,status,driver_id,created_at&is_emergency=eq.true&order=created_at.desc&limit=20"
  $rows = Sb-Get $q

  if (-not $rows -or $rows.Count -eq 0) {
    Die "No emergency bookings found. Create one in the app first, or set env JRIDE_BOOKING_ID."
  }

  $pick = $rows | Select-Object -First 1
  $BookingId = $pick.id
  Info ("Picked booking_id = {0}, code={1}, status={2}, driver_id={3}" -f $pick.id, $pick.booking_code, $pick.status, $pick.driver_id)
} else {
  Info "Using provided booking_id from env JRIDE_BOOKING_ID: $BookingId"
}

# Get booking details for later checks
$b = Sb-Get ("/rest/v1/bookings?select=id,booking_code,is_emergency,status,driver_id& id=eq.$BookingId")
if (-not $b -or $b.Count -eq 0) { Die "Booking not found in DB: $BookingId" }
$booking = $b[0]
Info ("Booking: id={0}, code={1}, emergency={2}, status={3}, driver_id={4}" -f $booking.id, $booking.booking_code, $booking.is_emergency, $booking.status, $booking.driver_id)

if (-not $booking.is_emergency) { Die "This booking is not emergency. Pick an emergency booking." }
if (-not $booking.driver_id)    { Die "Booking has no driver_id yet. Assign a driver first (auto-assign/manual assign) then rerun." }

# -----------------------------
# 1) Call dispatch/status -> completed (first time)
# -----------------------------
Info "Calling dispatch/status -> completed (1st call)..."
$r1 = Invoke-JsonPost "$BaseUrl/api/dispatch/status" @{
  booking_id = $BookingId
  status     = "completed"
}
Ok ("dispatch/status response: " + ($r1 | ConvertTo-Json -Depth 6))

# -----------------------------
# 2) Verify driver_wallet_transactions has exactly ONE emergency credit row
# -----------------------------
function Count-EmergencyCredits() {
  $path = "/rest/v1/driver_wallet_transactions?select=id,amount,reason,booking_id,created_at&booking_id=eq.$BookingId&reason=eq.emergency_pickup_fee_driver"
  $rows = Sb-Get $path
  return $rows
}

Info "Checking driver_wallet_transactions for emergency credit..."
$credits1 = Count-EmergencyCredits
$cnt1 = if ($credits1) { $credits1.Count } else { 0 }
Info "Found $cnt1 rows for reason=emergency_pickup_fee_driver booking_id=$BookingId"
if ($cnt1 -ne 1) {
  Write-Host ($credits1 | ConvertTo-Json -Depth 6)
  Die "Expected exactly 1 emergency credit row after 1st completion call."
}
if ([int]$credits1[0].amount -ne 20) {
  Die ("Expected amount=20, got amount=" + $credits1[0].amount)
}
Ok "✅ Driver emergency credit exists and is correct (₱20)."

# -----------------------------
# 3) Call dispatch/status -> completed again (idempotency)
# -----------------------------
Info "Calling dispatch/status -> completed (2nd call, idempotency check)..."
$r2 = Invoke-JsonPost "$BaseUrl/api/dispatch/status" @{
  booking_id = $BookingId
  status     = "completed"
}
Ok ("dispatch/status response (2nd): " + ($r2 | ConvertTo-Json -Depth 6))

Info "Re-checking driver_wallet_transactions for duplicates..."
$credits2 = Count-EmergencyCredits
$cnt2 = if ($credits2) { $credits2.Count } else { 0 }
Info "Found $cnt2 rows (should still be 1)."
if ($cnt2 -ne 1) {
  Write-Host ($credits2 | ConvertTo-Json -Depth 6)
  Die "❌ Duplicate detected! Expected 1 row even after 2nd completion call."
}

Ok "✅ Idempotency PASS: no duplicate emergency credit."
Ok "STEP 5E (driver ₱20) verified."
