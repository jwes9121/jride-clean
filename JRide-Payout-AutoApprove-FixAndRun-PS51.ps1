Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$scriptPath = Join-Path $repo "JRide-Payout-AutoApprove-FixAndRun-PS51.ps1"

@'
param()

function Fail($msg) { throw $msg }
function Require($cond, $msg) { if (-not $cond) { Fail $msg } }

function Read-EnvFile($path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }

  # Read raw lines safely
  $lines = Get-Content -LiteralPath $path
  foreach ($raw in $lines) {
    $line = ($raw + "").Trim()
    if ($line.Length -eq 0) { continue }
    if ($line.StartsWith("#")) { continue }

    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { continue }

    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()

    # Strip wrapping quotes
    if ($v.StartsWith('"') -and $v.EndsWith('"') -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    if ($v.StartsWith("'") -and $v.EndsWith("'") -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }

    $map[$k] = $v
  }

  return $map
}

function FirstNonEmpty([object[]]$vals) {
  foreach ($v in $vals) {
    if ($null -ne $v -and ("" + $v).Trim().Length -gt 0) { return ("" + $v).Trim() }
  }
  return $null
}

function Get-Config() {
  $root = $PSScriptRoot
  if (-not $root) { $root = (Get-Location).Path }

  $envPath = Join-Path $root ".env.local"
  $m = Read-EnvFile $envPath

  $url = FirstNonEmpty @(
    $m["NEXT_PUBLIC_SUPABASE_URL"],
    $m["SUPABASE_URL"],
    $env:NEXT_PUBLIC_SUPABASE_URL,
    $env:SUPABASE_URL
  )

  $sr = FirstNonEmpty @(
    $m["SUPABASE_SERVICE_ROLE_KEY"],
    $m["SERVICE_ROLE_KEY"],
    $env:SUPABASE_SERVICE_ROLE_KEY,
    $env:SERVICE_ROLE_KEY
  )

  Require ($url -and $sr) "Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local"

  return [pscustomobject]@{
    Url = $url.TrimEnd("/")
    ServiceRole = $sr
  }
}

function Invoke-SB($cfg, $method, $pathWithQuery, $headers, $bodyObj) {
  $uri = "$($cfg.Url)$pathWithQuery"
  try {
    if ($null -ne $bodyObj) {
      $json = $bodyObj | ConvertTo-Json -Depth 30
      return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -Body $json -ContentType "application/json"
    } else {
      return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers
    }
  } catch {
    $err = $_
    Write-Host ""
    Write-Host ("[FAIL] {0} {1}" -f $method, $uri) -ForegroundColor Red
    try {
      $resp = $err.Exception.Response
      if ($resp -and $resp.GetResponseStream()) {
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $txt = $sr.ReadToEnd()
        if ($txt) {
          Write-Host "---- error body ----" -ForegroundColor DarkYellow
          Write-Host $txt
          Write-Host "-------------------" -ForegroundColor DarkYellow
        } else {
          Write-Host "(No response body)" -ForegroundColor DarkYellow
        }
      } else {
        Write-Host "(No response body)" -ForegroundColor DarkYellow
      }
    } catch {
      Write-Host "(No response body)" -ForegroundColor DarkYellow
    }
    throw
  }
}

function UrlEncode($s) {
  return [System.Uri]::EscapeDataString($s)
}

Write-Host ""
Write-Host "JRide: Auto-Approve Fix + Topup (Option A) - PS5.1 SAFE" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

$cfg = Get-Config

$headersSR = @{
  apikey = $cfg.ServiceRole
  Authorization = "Bearer $($cfg.ServiceRole)"
}

# -------------------------
# STEP 1: Ensure rule enabled
# -------------------------
Write-Host ""
Write-Host "Step 1) Ensure driver_payout_rules is enabled + buffers set..." -ForegroundColor DarkCyan

$rules = Invoke-SB $cfg "GET" "/rest/v1/driver_payout_rules?select=id,enabled,max_amount,min_buffer,min_wallet_buffer,note,updated_by,updated_at&order=id.asc&limit=20" $headersSR $null

$ruleId = $null
if ($rules -and $rules.Count -ge 1) {
  $ruleId = [int64]$rules[0].id
} else {
  # Create a default row (id is bigint/serial; do NOT set id manually)
  $createHdr = @{}
  $headersSR.GetEnumerator() | ForEach-Object { $createHdr[$_.Key] = $_.Value }
  $createHdr["Prefer"] = "return=representation"

  $created = Invoke-SB $cfg "POST" "/rest/v1/driver_payout_rules" $createHdr @{
    enabled = $true
    max_amount = 100000
    min_buffer = 0
    min_wallet_buffer = 0
    note = "default auto-approve rule"
    updated_by = "admin"
  }

  Require ($created -and $created.Count -ge 1) "Failed to create driver_payout_rules row."
  $ruleId = [int64]$created[0].id
}

# Update rule to desired values
$patchHdr = @{}
$headersSR.GetEnumerator() | ForEach-Object { $patchHdr[$_.Key] = $_.Value }
$patchHdr["Prefer"] = "return=representation"

$updatedRule = Invoke-SB $cfg "PATCH" ("/rest/v1/driver_payout_rules?id=eq.{0}" -f $ruleId) $patchHdr @{
  enabled = $true
  # keep max_amount high so it doesn't block small payouts
  max_amount = 100000
  # buffer 0 = strict "wallet must stay >= min_wallet_required"
  min_buffer = 0
  min_wallet_buffer = 0
  note = "enabled (Option A) - keep min_wallet_required rule; topup for tests"
  updated_by = "admin"
}

Write-Host ("Rule OK: id={0} enabled={1} min_buffer={2} min_wallet_buffer={3} max_amount={4}" -f `
  $ruleId, $updatedRule[0].enabled, $updatedRule[0].min_buffer, $updatedRule[0].min_wallet_buffer, $updatedRule[0].max_amount) -ForegroundColor Green

# Read buffer used by DB logic (min_buffer)
$buffer = 0
try {
  $buffer = [decimal]$updatedRule[0].min_buffer
} catch { $buffer = 0 }

# -------------------------
# STEP 2: Find pending payouts + compute needed topups
# -------------------------
Write-Host ""
Write-Host "Step 2) Load pending payouts and compute required topups..." -ForegroundColor DarkCyan

$payouts = Invoke-SB $cfg "GET" "/rest/v1/driver_payout_requests?select=id,driver_id,amount,status,requested_at&status=eq.pending&order=requested_at.desc&limit=200" $headersSR $null
if (-not $payouts -or $payouts.Count -eq 0) {
  Write-Host "No pending payouts found. Nothing to auto-approve." -ForegroundColor Yellow
  exit 0
}

# Unique driver ids
$driverIds = @{}
foreach ($p in $payouts) { $driverIds[$p.driver_id] = $true }
$idsList = ($driverIds.Keys | ForEach-Object { '"' + $_ + '"' }) -join ","
$inFilter = "in.(" + $idsList + ")"
$driversPath = "/rest/v1/drivers?select=id,wallet_balance,min_wallet_required&id=" + (UrlEncode $inFilter)

$drivers = Invoke-SB $cfg "GET" $driversPath $headersSR $null
Require ($drivers -and $drivers.Count -ge 1) "Could not load drivers for pending payouts."

# Index drivers
$drvMap = @{}
foreach ($d in $drivers) { $drvMap[$d.id] = $d }

# Compute topups per payout (Option A: top up so wallet_after >= min_wallet_required + buffer)
$topups = @()
foreach ($p in $payouts) {
  $d = $drvMap[$p.driver_id]
  if (-not $d) { continue }

  $wallet = 0
  $minReq = 0
  $amt = 0

  try { $wallet = [decimal]$d.wallet_balance } catch { $wallet = 0 }
  try { $minReq = [decimal]$d.min_wallet_required } catch { $minReq = 0 }
  try { $amt = [decimal]$p.amount } catch { $amt = 0 }

  $requiredAfter = $minReq + $buffer
  $walletAfter = $wallet - $amt

  if ($walletAfter -lt $requiredAfter) {
    $need = $requiredAfter - $walletAfter  # minimum topup so it becomes eligible
    if ($need -lt 0) { $need = 0 }
    $topups += [pscustomobject]@{
      payout_id = $p.id
      driver_id = $p.driver_id
      amount = $amt
      wallet = $wallet
      min_required = $minReq
      topup_needed = [decimal]([math]::Ceiling([double]$need))  # round up to whole peso
    }
  }
}

if ($topups.Count -eq 0) {
  Write-Host "All pending payouts are already eligible. Proceeding to auto-approve..." -ForegroundColor Green
} else {
  Write-Host ("Pending payouts: {0}. Need topups for: {1}" -f $payouts.Count, $topups.Count) -ForegroundColor Yellow

  # -------------------------
  # STEP 3: Apply topups using your RPC
  # -------------------------
  Write-Host ""
  Write-Host "Step 3) Applying topups using admin_adjust_driver_wallet()..." -ForegroundColor DarkCyan

  foreach ($t in $topups) {
    $note = "topup_for_payout#" + $t.payout_id
    Write-Host ("Topup driver {0}: +{1} (wallet={2} min={3} payout={4})" -f `
      $t.driver_id, $t.topup_needed, $t.wallet, $t.min_required, $t.amount) -ForegroundColor DarkGray

    Invoke-SB $cfg "POST" "/rest/v1/rpc/admin_adjust_driver_wallet" $headersSR @{
      p_driver_id = $t.driver_id
      p_amount = [decimal]$t.topup_needed
      p_reason = $note
      p_admin = "admin"
    } | Out-Null
  }
}

# -------------------------
# STEP 4: Run auto-approve
# -------------------------
Write-Host ""
Write-Host "Step 4) Running admin_auto_approve_driver_payouts..." -ForegroundColor DarkCyan

$limit = 50
$res = Invoke-SB $cfg "POST" "/rest/v1/rpc/admin_auto_approve_driver_payouts" $headersSR @{ p_limit = [int]$limit }

Write-Host ("Auto-approve result: " + ($res | ConvertTo-Json -Depth 10)) -ForegroundColor Green

# Re-check pending after run
Start-Sleep -Seconds 1
$pendingAfter = Invoke-SB $cfg "GET" "/rest/v1/driver_payout_requests?select=id,driver_id,amount,status,processed_at&status=eq.pending&order=requested_at.desc&limit=50" $headersSR $null

Write-Host ""
if ($pendingAfter -and $pendingAfter.Count -gt 0) {
  Write-Host ("Still pending after run: {0} (showing up to 50)" -f $pendingAfter.Count) -ForegroundColor Yellow
  $pendingAfter | Select-Object id,driver_id,amount,status,processed_at | Format-Table | Out-String | Write-Host
  Write-Host "If any remain pending, they are blocked by the DB rule (wallet would drop below minimum) or max_amount rule." -ForegroundColor Yellow
} else {
  Write-Host "✅ No pending payouts remain (within last 50). Auto-approve succeeded." -ForegroundColor Green
}
'@ | Out-File -FilePath $scriptPath -Encoding utf8

Write-Host "Wrote: $scriptPath" -ForegroundColor Green
& $scriptPath
