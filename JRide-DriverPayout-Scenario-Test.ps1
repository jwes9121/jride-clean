param()

# --------- Load Supabase env from .env.local (no manual edits) ----------
$envFile = Join-Path (Get-Location) ".env.local"
if (Test-Path $envFile) {
  $lines = Get-Content $envFile -ErrorAction SilentlyContinue
  foreach ($line in $lines) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*$') { continue }
    if ($line -match '^\s*([^=]+?)\s*=\s*(.*)\s*$') {
      $k = $matches[1].Trim()
      $v = $matches[2].Trim().Trim('"')
      if (-not [string]::IsNullOrWhiteSpace($k)) {
        [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
      }
    }
  }
}

$SB_URL = $env:NEXT_PUBLIC_SUPABASE_URL
$SB_ANON = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY

if (-not $SB_URL -or -not $SB_ANON) {
  Write-Host "❌ Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local" -ForegroundColor Red
  exit 1
}

# Normalize URL
$SB_URL = $SB_URL.TrimEnd('/')

$headers = @{
  "apikey" = $SB_ANON
  "Authorization" = "Bearer $SB_ANON"
  "Content-Type" = "application/json"
}

function Invoke-SupaGet([string]$path) {
  $uri = "$SB_URL$path"
  return Invoke-RestMethod -Method GET -Uri $uri -Headers $headers
}

function Invoke-SupaPost([string]$path, $bodyObj) {
  $uri = "$SB_URL$path"
  $json = ($bodyObj | ConvertTo-Json -Depth 10)
  return Invoke-RestMethod -Method POST -Uri $uri -Headers $headers -Body $json
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "JRide Driver Payout Scenario Test (NO MANUAL EDITS)" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# ---------- Pick drivers automatically ----------
# SUCCESS driver: wallet_balance >= min_wallet_required + 20
# FAIL driver: wallet_balance <  min_wallet_required + 20
Write-Host "`nFinding SUCCESS driver (wallet >= min + 20)..." -ForegroundColor Cyan
$successRows = Invoke-SupaGet "/rest/v1/drivers?select=id,wallet_balance,min_wallet_required&wallet_balance=gte.min_wallet_required+20&order=wallet_balance.desc&limit=1"
if (-not $successRows -or $successRows.Count -eq 0) {
  Write-Host "❌ Could not find any driver with wallet >= min + 20." -ForegroundColor Red
  exit 1
}
$success = $successRows[0]

Write-Host "OK: SUCCESS driver:" -ForegroundColor Green
Write-Host "  id=$($success.id) wallet=$($success.wallet_balance) min=$($success.min_wallet_required)" -ForegroundColor Green

Write-Host "`nFinding FAIL driver (wallet < min + 20)..." -ForegroundColor Cyan
$failRows = Invoke-SupaGet "/rest/v1/drivers?select=id,wallet_balance,min_wallet_required&wallet_balance=lt.min_wallet_required+20&order=wallet_balance.asc&limit=1"
if (-not $failRows -or $failRows.Count -eq 0) {
  Write-Host "⚠️ Could not find a FAIL driver with wallet < min + 20. (This is OK if all wallets are healthy.)" -ForegroundColor Yellow
  $fail = $null
} else {
  $fail = $failRows[0]
  Write-Host "OK: FAIL driver:" -ForegroundColor Yellow
  Write-Host "  id=$($fail.id) wallet=$($fail.wallet_balance) min=$($fail.min_wallet_required)" -ForegroundColor Yellow
}

# ---------- Scenario A: expected SUCCESS ----------
$amount = 20
Write-Host "`n----------------------------------------------" -ForegroundColor Cyan
Write-Host "SCENARIO A (expected SUCCESS): driver_request_payout ₱$amount" -ForegroundColor Cyan
Write-Host "----------------------------------------------" -ForegroundColor Cyan

try {
  # IMPORTANT: PostgREST expects named args: p_driver_id, p_amount
  $respA = Invoke-SupaPost "/rest/v1/rpc/driver_request_payout" @{
    p_driver_id = $success.id
    p_amount    = $amount
  }
  Write-Host "✅ RPC SUCCESS (Scenario A). Now verifying latest pending row..." -ForegroundColor Green
} catch {
  Write-Host "❌ RPC FAILED (Scenario A): $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
    Write-Host $_.ErrorDetails.Message -ForegroundColor DarkRed
  }
  throw
}

# Fetch newest pending payout for that driver
$pendingA = Invoke-SupaGet "/rest/v1/driver_payout_requests?select=id,driver_id,amount,status,requested_at&driver_id=eq.$($success.id)&status=eq.pending&order=requested_at.desc&limit=1"
if ($pendingA -and $pendingA.Count -gt 0) {
  $p = $pendingA[0]
  Write-Host "✅ Pending payout created: id=$($p.id) amount=$($p.amount) status=$($p.status)" -ForegroundColor Green
  Write-Host "NEXT: Go to Admin → Driver Payouts and approve payout ID #$($p.id)." -ForegroundColor Cyan
} else {
  Write-Host "⚠️ No pending row found. If your system auto-approved immediately, check PAID tab / audit." -ForegroundColor Yellow
}

# ---------- Scenario B: expected MIN-WALLET FAIL ----------
if ($fail) {
  Write-Host "`n----------------------------------------------" -ForegroundColor Cyan
  Write-Host "SCENARIO B (expected MIN-WALLET FAIL): driver_request_payout ₱$amount" -ForegroundColor Cyan
  Write-Host "----------------------------------------------" -ForegroundColor Cyan

  try {
    $respB = Invoke-SupaPost "/rest/v1/rpc/driver_request_payout" @{
      p_driver_id = $fail.id
      p_amount    = $amount
    }
    Write-Host "⚠️ RPC succeeded but was expected to fail. Check your min-wallet logic." -ForegroundColor Yellow
  } catch {
    Write-Host "✅ Expected failure happened (Scenario B)." -ForegroundColor Green
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      Write-Host "Server said: $($_.ErrorDetails.Message)" -ForegroundColor DarkYellow
    } else {
      Write-Host "Error: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
  }
}

Write-Host "`n✅ Scenario test finished." -ForegroundColor Green
Write-Host "Open these to confirm visually:" -ForegroundColor Cyan
Write-Host "  1) /admin/payouts/drivers   (approve pending)" -ForegroundColor Cyan
Write-Host "  2) /driver/wallet           (payout history + wallet activity updates)" -ForegroundColor Cyan
