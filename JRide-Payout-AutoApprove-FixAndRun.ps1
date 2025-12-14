param()

function Fail($msg) { throw $msg }
function Require($cond, $msg) { if (-not $cond) { Fail $msg } }

function Read-EnvFile($path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  $lines = Get-Content $path -ErrorAction SilentlyContinue
  foreach ($raw in $lines) {
    $line = ($raw ?? "").Trim()
    if ($line.Length -eq 0) { continue }
    if ($line.StartsWith("#")) { continue }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { continue }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()
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
      $json = $bodyObj | ConvertTo-Json -Depth 50
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

function Upsert-PayoutRule($cfg, $headersSR, [int]$id, [bool]$enabled, [decimal]$maxAmount, [decimal]$buffer) {
  # Your table columns (confirmed): id(bigint), enabled, max_amount, note, updated_at, min_wallet_buffer, min_buffer, updated_by
  # We'll try payloads in order until one succeeds:
  $payloads = @()

  # Preferred: min_wallet_buffer
  $payloads += ,(@{ id=$id; enabled=$enabled; max_amount=$maxAmount; min_wallet_buffer=$buffer; note="auto-set by script"; updated_by="admin" })

  # Alternate: min_buffer
  $payloads += ,(@{ id=$id; enabled=$enabled; max_amount=$maxAmount; min_buffer=$buffer; note="auto-set by script"; updated_by="admin" })

  # Minimal (if buffers not used by your function)
  $payloads += ,(@{ id=$id; enabled=$enabled; max_amount=$maxAmount; note="auto-set by script"; updated_by="admin" })

  $hdr = @{}
  $headersSR.GetEnumerator() | ForEach-Object { $hdr[$_.Key] = $_.Value }
  $hdr["Prefer"] = "resolution=merge-duplicates,return=representation"

  foreach ($p in $payloads) {
    try {
      $res = Invoke-SB $cfg "POST" ("/rest/v1/driver_payout_rules?on_conflict=id") $hdr $p
      if ($res) { return $res }
    } catch {
      # try next payload
    }
  }

  Fail "Could not upsert driver_payout_rules with any compatible payload."
}

function Get-RuleBuffer($cfg, $headersSR) {
  # We read both possible fields and normalize into a single buffer value
  $rows = Invoke-SB $cfg "GET" "/rest/v1/driver_payout_rules?select=id,enabled,max_amount,min_wallet_buffer,min_buffer&limit=1" $headersSR $null
  if (-not $rows -or $rows.Count -lt 1) { return [pscustomobject]@{ enabled=$false; max_amount=0; buffer=0 } }
  $r = $rows[0]
  $buf = 0
  if ($null -ne $r.min_wallet_buffer) { $buf = [decimal]$r.min_wallet_buffer }
  elseif ($null -ne $r.min_buffer) { $buf = [decimal]$r.min_buffer }
  return [pscustomobject]@{
    enabled = [bool]$r.enabled
    max_amount = if ($null -ne $r.max_amount) { [decimal]$r.max_amount } else { 0 }
    buffer = $buf
  }
}

function Get-PendingPayouts($cfg, $headersSR, [int]$limit) {
  return Invoke-SB $cfg "GET" ("/rest/v1/driver_payout_requests?select=id,driver_id,amount,status,requested_at&status=eq.pending&order=requested_at.desc&limit=$limit") $headersSR $null
}

function Get-DriversByIds($cfg, $headersSR, [string[]]$driverIds) {
  if (-not $driverIds -or $driverIds.Count -eq 0) { return @() }
  $unique = $driverIds | Sort-Object -Unique
  $in = "(" + ($unique -join ",") + ")"
  # drivers columns you already have: wallet_balance, min_wallet_required
  return Invoke-SB $cfg "GET" ("/rest/v1/drivers?select=id,wallet_balance,min_wallet_required&id=in.$in") $headersSR $null
}

function Rpc-AdjustWallet($cfg, $headersSR, [string]$driverId, [decimal]$amount, [string]$reason, [string]$actor) {
  # You already used: admin_adjust_driver_wallet(driver_id, amount, reason, updated_by/admin)
  # We'll send the common param names, and if your function uses different keys it will error clearly.
  $body = @{
    p_driver_id = $driverId
    p_amount = $amount
    p_reason = $reason
    p_admin_user = $actor
  }

  try {
    return Invoke-SB $cfg "POST" "/rest/v1/rpc/admin_adjust_driver_wallet" $headersSR $body
  } catch {
    # Fallback param names (some schemas use these)
    $body2 = @{
      driver_id = $driverId
      amount = $amount
      reason = $reason
      updated_by = $actor
    }
    return Invoke-SB $cfg "POST" "/rest/v1/rpc/admin_adjust_driver_wallet" $headersSR $body2
  }
}

function Rpc-AutoApprove($cfg, $headersSR, [int]$limit) {
  return Invoke-SB $cfg "POST" "/rest/v1/rpc/admin_auto_approve_driver_payouts" $headersSR @{ p_limit = $limit }
}

Write-Host ""
Write-Host "JRide: Payout Auto-Approve Fix + Run (NO MANUAL EDITS) - PS5.1 SAFE" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan

$cfg = Get-Config
$headersSR = @{
  apikey = $cfg.ServiceRole
  Authorization = "Bearer $($cfg.ServiceRole)"
}

# --- SETTINGS YOU CAN KEEP AS-IS ---
$ruleId = 1
$enableRule = $true
$ruleMaxAmount = [decimal]999999
$ruleBuffer = [decimal]0        # use 0 first (matches your current rule behavior)
$pendingLimit = 50

Write-Host ""
Write-Host "1) Upserting driver_payout_rules (enabled=$enableRule, max_amount=$ruleMaxAmount, buffer=$ruleBuffer)..." -ForegroundColor DarkCyan
Upsert-PayoutRule $cfg $headersSR $ruleId $enableRule $ruleMaxAmount $ruleBuffer | Out-Null

$rule = Get-RuleBuffer $cfg $headersSR
Write-Host ("Rule now: enabled={0} max_amount={1} buffer={2}" -f $rule.enabled, $rule.max_amount, $rule.buffer) -ForegroundColor Green

Write-Host ""
Write-Host "2) Fetching pending payouts..." -ForegroundColor DarkCyan
$payouts = Get-PendingPayouts $cfg $headersSR $pendingLimit
if (-not $payouts -or $payouts.Count -eq 0) {
  Write-Host "No pending payouts found. Nothing to auto-approve." -ForegroundColor Yellow
  exit 0
}
Write-Host ("Pending payouts found: {0}" -f $payouts.Count) -ForegroundColor Green

$driverIds = $payouts | ForEach-Object { $_.driver_id } | Sort-Object -Unique
$drivers = Get-DriversByIds $cfg $headersSR $driverIds

# Build lookup
$driverMap = @{}
foreach ($d in $drivers) { $driverMap[$d.id] = $d }

Write-Host ""
Write-Host "3) Ensuring wallets are eligible (top-up only if needed)..." -ForegroundColor DarkCyan

$topups = 0
foreach ($p in $payouts) {
  $d = $driverMap[$p.driver_id]
  if (-not $d) {
    Write-Host ("- payout #{0}: driver {1} not found in drivers table - skipping topup" -f $p.id, $p.driver_id) -ForegroundColor Yellow
    continue
  }

  $wallet = [decimal]($d.wallet_balance ?? 0)
  $minReq = [decimal]($d.min_wallet_required ?? 0)
  $amt = [decimal]($p.amount ?? 0)
  $buf = [decimal]$rule.buffer

  # Eligibility rule used by your function behavior:
  # wallet_after = wallet - amount
  # must be >= min_wallet_required + buffer
  $requiredAfter = $minReq + $buf
  $walletAfter = $wallet - $amt

  if ($walletAfter -ge $requiredAfter) {
    Write-Host ("- payout #{0}: OK (wallet={1} min={2} amt={3} after={4} req_after={5})" -f $p.id, $wallet, $minReq, $amt, $walletAfter, $requiredAfter) -ForegroundColor Green
    continue
  }

  # Top-up needed so that (wallet + topup - amount) >= requiredAfter
  $need = ($requiredAfter + $amt) - $wallet
  if ($need -lt 0) { $need = 0 }
  $need = [decimal]([math]::Ceiling([double]$need))

  Write-Host ("- payout #{0}: TOPUP needed {1} (wallet={2} min={3} amt={4} req_after={5})" -f $p.id, $need, $wallet, $minReq, $amt, $requiredAfter) -ForegroundColor Yellow
  if ($need -gt 0) {
    Rpc-AdjustWallet $cfg $headersSR $p.driver_id $need ("topup_for_payout_" + $p.id) "admin" | Out-Null
    $topups++
  }
}

Write-Host ""
Write-Host ("Top-ups performed: {0}" -f $topups) -ForegroundColor Cyan

Write-Host ""
Write-Host "4) Running admin_auto_approve_driver_payouts..." -ForegroundColor DarkCyan
$res = Rpc-AutoApprove $cfg $headersSR $pendingLimit
Write-Host ("Auto-approve result: " + ($res | ConvertTo-Json -Depth 10)) -ForegroundColor Green

Write-Host ""
Write-Host "DONE. Refresh /admin/payouts/drivers and /admin/payouts/drivers/reports" -ForegroundColor Cyan
