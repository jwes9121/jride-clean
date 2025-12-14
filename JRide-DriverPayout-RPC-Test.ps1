Param(
  [string]$DriverId = "45e66af4-f7d1-4a34-a74e-52d274cecd0f",
  [decimal]$Amount = 20
)

$ErrorActionPreference = "Stop"

function Get-EnvFromFile([string]$filePath, [string]$name) {
  if (-not (Test-Path $filePath)) { return $null }
  $line = Select-String -Path $filePath -Pattern "^\s*$name\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $line) { return $null }
  $parts = $line.Line -split "=", 2
  if ($parts.Count -lt 2) { return $null }
  $value = $parts[1].Trim()
  if ($value.StartsWith('"') -and $value.EndsWith('"')) {
    $value = $value.Trim('"')
  }
  return $value
}

function Get-EnvValue([string]$name) {
  $fromProcess = [Environment]::GetEnvironmentVariable($name, "Process")
  if ($fromProcess) { return $fromProcess }

  $envFile = ".env.local"
  if (Test-Path $envFile) {
    $fromFile = Get-EnvFromFile $envFile $name
    if ($fromFile) { return $fromFile }
  }

  $fromUser = [Environment]::GetEnvironmentVariable($name, "User")
  if ($fromUser) { return $fromUser }

  $fromMachine = [Environment]::GetEnvironmentVariable($name, "Machine")
  if ($fromMachine) { return $fromMachine }

  return $null
}

Write-Host "🔧 JRide driver payout RPC test" -ForegroundColor Cyan

$supabaseUrl = Get-EnvValue "NEXT_PUBLIC_SUPABASE_URL"
if (-not $supabaseUrl) {
  throw "NEXT_PUBLIC_SUPABASE_URL not found in environment or .env.local"
}

$anonKey = Get-EnvValue "NEXT_PUBLIC_SUPABASE_ANON_KEY"
if (-not $anonKey) {
  throw "NEXT_PUBLIC_SUPABASE_ANON_KEY not found. Make sure .env.local is present."
}

$driverId = $DriverId.Trim()
if (-not $driverId) {
  throw "DriverId is empty. Pass -DriverId or update the default at the top of the script."
}

$baseUrl = $supabaseUrl.TrimEnd("/")

$headers = @{
  apikey         = $anonKey
  Authorization  = "Bearer $anonKey"
  "Content-Type" = "application/json"
}

Write-Host ""
Write-Host "STEP 1 – Call driver_request_payout RPC" -ForegroundColor Cyan

$rpcBody = @{
  p_driver_id = $driverId
  p_amount    = $Amount
} | ConvertTo-Json

try {
  $uri  = "$baseUrl/rest/v1/rpc/driver_request_payout"
  $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $rpcBody
  Write-Host "✅ driver_request_payout RPC succeeded." -ForegroundColor Green
  Write-Host "   (Return is usually empty for RETURNS void)" -ForegroundColor DarkGray
}
catch {
  Write-Host "❌ driver_request_payout RPC failed." -ForegroundColor Red
  Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "   Most likely causes:" -ForegroundColor Yellow
  Write-Host "   • Function name or signature is different in Supabase" -ForegroundColor Yellow
  Write-Host "   • RPC not exposed at /rest/v1/rpc/driver_request_payout" -ForegroundColor Yellow
  Write-Host "   • RLS is blocking anon key for this RPC" -ForegroundColor Yellow
  return
}

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "STEP 2 – Fetch most recent *pending* payout for this driver" -ForegroundColor Cyan

try {
  $pendingUri = "$baseUrl/rest/v1/driver_payout_requests" +
    "?driver_id=eq.$driverId&status=eq.pending" +
    "&select=id,amount,status,requested_at,processed_at" +
    "&order=requested_at.desc&limit=1"

  $rows = Invoke-RestMethod -Method Get -Uri $pendingUri -Headers $headers
}
catch {
  Write-Host "❌ Failed to query driver_payout_requests." -ForegroundColor Red
  Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
  return
}

if (-not $rows -or $rows.Count -eq 0) {
  Write-Host "⚠️  No pending payout rows found for this driver (RPC may have raised min-wallet error)." -ForegroundColor Yellow
  return
}

$pending = if ($rows -is [System.Collections.IEnumerable]) { $rows[0] } else { $rows }

Write-Host ""
Write-Host "✅ Pending payout found:" -ForegroundColor Green
Write-Host "  id          = $($pending.id)"
Write-Host "  amount      = $($pending.amount)"
Write-Host "  status      = $($pending.status)"
Write-Host "  requestedAt = $($pending.requested_at)"

Write-Host ""
Write-Host "➡  Approve/reject this payout in the Admin → Driver Payouts page as usual." -ForegroundColor Cyan
Write-Host "✅ RPC + pending-row flow is working." -ForegroundColor Green
