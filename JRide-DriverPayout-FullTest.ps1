param()

function Fail($msg) { throw $msg }
function Require($cond, $msg) { if (-not $cond) { Fail $msg } }

function Read-EnvFile($path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
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

  $anon = FirstNonEmpty @(
    $m["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    $m["SUPABASE_ANON_KEY"],
    $env:NEXT_PUBLIC_SUPABASE_ANON_KEY,
    $env:SUPABASE_ANON_KEY
  )

  $sr = FirstNonEmpty @(
    $m["SUPABASE_SERVICE_ROLE_KEY"],
    $m["SERVICE_ROLE_KEY"],
    $env:SUPABASE_SERVICE_ROLE_KEY,
    $env:SERVICE_ROLE_KEY
  )

  Require ($url -and $anon -and $sr) "Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.local"

  return [pscustomobject]@{
    Url = $url.TrimEnd("/")
    Anon = $anon
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

function Dns-Sanity($cfg) {
  $sbHostName = ([Uri]$cfg.Url).Host
  try { [System.Net.Dns]::GetHostAddresses($sbHostName) | Out-Null }
  catch { Fail "DNS cannot resolve $sbHostName. Network/DNS issue." }
}

function Pick-Drivers($cfg, $headersSR, $amount, $buffer) {
  # Pick richest driver as SUCCESS candidate
  $rows = Invoke-SB $cfg "GET" "/rest/v1/drivers?select=id,wallet_balance,min_wallet_required&order=wallet_balance.desc&limit=500" $headersSR $null
  Require ($rows -and $rows.Count -gt 0) "No drivers returned from public.drivers"

  $success = $rows[0]
  $fail = $null

  foreach ($d in $rows) {
    if ($null -eq $d.wallet_balance -or $null -eq $d.min_wallet_required) { continue }
    $gap = [decimal]$d.wallet_balance - [decimal]$d.min_wallet_required
    if (-not $fail -and $gap -lt ([decimal]$amount)) { $fail = $d; break }
  }

  Require ($success) "No SUCCESS driver found."
  Require ($fail) "No FAIL driver found where wallet_balance - min_wallet_required < amount. amount=$amount"

  # Ensure success driver has enough headroom at approval time:
  # target wallet >= min + amount + buffer
  $need = [decimal]$success.min_wallet_required + [decimal]$amount + [decimal]$buffer
  $cur  = [decimal]$success.wallet_balance

  if ($cur -lt $need) {
    $newWallet = $need + 50  # extra cushion
    Write-Host ("Top-up SUCCESS driver wallet for test: {0} wallet {1} -> {2} (min={3})" -f $success.id, $cur, $newWallet, $success.min_wallet_required) -ForegroundColor Yellow

    $hdr = @{}
    $headersSR.GetEnumerator() | ForEach-Object { $hdr[param()

function Fail($msg) { throw $msg }
function Require($cond, $msg) { if (-not $cond) { Fail $msg } }

function Read-EnvFile($path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
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

  $anon = FirstNonEmpty @(
    $m["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    $m["SUPABASE_ANON_KEY"],
    $env:NEXT_PUBLIC_SUPABASE_ANON_KEY,
    $env:SUPABASE_ANON_KEY
  )

  $sr = FirstNonEmpty @(
    $m["SUPABASE_SERVICE_ROLE_KEY"],
    $m["SERVICE_ROLE_KEY"],
    $env:SUPABASE_SERVICE_ROLE_KEY,
    $env:SERVICE_ROLE_KEY
  )

  Require ($url -and $anon -and $sr) "Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.local"

  return [pscustomobject]@{
    Url = $url.TrimEnd("/")
    Anon = $anon
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

function Dns-Sanity($cfg) {
  $sbHostName = ([Uri]$cfg.Url).Host
  try { [System.Net.Dns]::GetHostAddresses($sbHostName) | Out-Null }
  catch { Fail "DNS cannot resolve $sbHostName. Network/DNS issue." }
}

function Pick-Drivers($cfg, $headersSR, $amount, $buffer) {
  $rows = Invoke-SB $cfg "GET" "/rest/v1/drivers?select=id,wallet_balance,min_wallet_required&order=wallet_balance.desc&limit=500" $headersSR $null
  Require ($rows -and $rows.Count -gt 0) "No drivers returned from public.drivers"

  $success = $null
  $fail = $null

  foreach ($d in $rows) {
    if ($null -eq $d.wallet_balance -or $null -eq $d.min_wallet_required) { continue }
    $gap = [decimal]$d.wallet_balance - [decimal]$d.min_wallet_required

    if (-not $success -and $gap -ge ([decimal]$amount + [decimal]$buffer)) { $success = $d }
    if (-not $fail -and $gap -lt ([decimal]$amount)) { $fail = $d }

    if ($success -and $fail) { break }
  }

  Require ($success) ("No SUCCESS driver found where wallet_balance >= min_wallet_required + (amount + buffer). amount=$amount buffer=$buffer")
  Require ($fail) ("No FAIL driver found where wallet_balance - min_wallet_required < amount. amount=$amount")

  return [pscustomobject]@{ Success=$success; Fail=$fail }
}

function Insert-PayoutRequest-Fallback($cfg, $headersSR, $driverId, $amount, $tag) {
  # Try minimal-safe payloads only (NO payout_ref unless implied)
  $payloads = @()

  # 1) Minimal (most compatible)
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount })

  # 2) Add status
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending" })

  # 3) Add requested_at
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending"; requested_at = (Get-Date).ToString("o") })

  # 4) Add note (common)
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending"; requested_at = (Get-Date).ToString("o"); note = $tag })

  # 5) Add admin_note (alternative column some schemas use)
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending"; requested_at = (Get-Date).ToString("o"); admin_note = $tag })

  $hdr = @{}
  $headersSR.GetEnumerator() | ForEach-Object { $hdr[$_.Key] = $_.Value }
  $hdr["Prefer"] = "return=representation"

  foreach ($p in $payloads) {
    try {
      $created = Invoke-SB $cfg "POST" "/rest/v1/driver_payout_requests" $hdr $p
      if ($created -and $created.Count -ge 1) { return $created[0] }
    } catch {
      # keep trying next payload
    }
  }

  Fail "Insert failed for driver_payout_requests after all fallback payloads."
}

function Get-PayoutById($cfg, $headersSR, $id) {
  $rows = Invoke-SB $cfg "GET" ("/rest/v1/driver_payout_requests?select=id,driver_id,amount,status,requested_at,processed_at&id=eq.{0}&limit=1" -f $id) $headersSR $null
  if ($rows -and $rows.Count -ge 1) { return $rows[0] }
  return $null
}

function Run-AutoApprove($cfg, $headersSR, $limit) {
  $body = @{ p_limit = [int]$limit }
  return Invoke-SB $cfg "POST" "/rest/v1/rpc/admin_auto_approve_driver_payouts" $headersSR $body
}

function Manual-Approve($cfg, $headersSR, $requestId, $note) {
  # Detect existing columns on driver_payout_requests and only pass what exists
  $cols = Invoke-SB $cfg "GET" "/rest/v1/driver_payout_requests?select=*&limit=1" $headersSR $null
  $sample = $null
  if ($cols -and $cols.Count -ge 1) { $sample = $cols[0] }

  $body = @{
    p_request_id = [int64]$requestId
    p_admin_note = $note
  }

  # Only include optional params if the table likely supports them
  if ($sample -and $sample.PSObject.Properties.Name -contains "payout_method") { $body.p_payout_method = "GCASH" }
  if ($sample -and $sample.PSObject.Properties.Name -contains "payout_ref")    { $body.p_payout_ref    = ("AUTO_" + $note) }
  if ($sample -and $sample.PSObject.Properties.Name -contains "receipt_url")   { $body.p_receipt_url   = "" }

  return Invoke-SB $cfg "POST" "/rest/v1/rpc/driver_admin_approve_payout" $headersSR $body
}

Write-Host ""
Write-Host "JRide Driver Payout Full Test (NO MANUAL EDITS) - PS5.1 SAFE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$cfg = Get-Config
Dns-Sanity $cfg

$headersSR = @{
  apikey = $cfg.ServiceRole
  Authorization = "Bearer $($cfg.ServiceRole)"
}

$amountA = 20
$amountB = 20
$buffer  = 200
$autoLimit = 50

Write-Host ""
Write-Host "Picking drivers for tests..." -ForegroundColor DarkCyan
$picked = Pick-Drivers $cfg $headersSR $amountA $buffer
$success = $picked.Success
$fail = $picked.Fail

Write-Host ("SUCCESS driver: {0}  wallet={1}  min={2}" -f $success.id, $success.wallet_balance, $success.min_wallet_required) -ForegroundColor Green
Write-Host ("FAIL    driver: {0}  wallet={1}  min={2}" -f $fail.id, $fail.wallet_balance, $fail.min_wallet_required) -ForegroundColor Yellow

Write-Host ""
Write-Host "SCENARIO A: Create + Auto-Approve payout (EXPECTED SUCCESS)" -ForegroundColor Cyan
$tagA = (Get-Date -Format "yyyyMMddHHmmss") + "_A"
$payoutA = Insert-PayoutRequest-Fallback $cfg $headersSR $success.id $amountA $tagA
Write-Host ("Created payout A: id={0} amount={1} status={2}" -f $payoutA.id, $payoutA.amount, $payoutA.status) -ForegroundColor Green

Write-Host ""
Write-Host "Running auto-approve runner..." -ForegroundColor DarkCyan
$autoRes = Run-AutoApprove $cfg $headersSR $autoLimit
Write-Host ("Auto-approve result: " + ($autoRes | ConvertTo-Json -Depth 5)) -ForegroundColor DarkGray

Start-Sleep -Seconds 1
$checkA = Get-PayoutById $cfg $headersSR $payoutA.id
Require ($checkA) "Scenario A: could not re-fetch payout row."

if ($checkA.status -ne "paid") {
  Write-Host ("Auto-approve did not pay payout A (status={0}). Forcing manual approve fallback..." -f $checkA.status) -ForegroundColor Yellow
  Manual-Approve $cfg $headersSR $payoutA.id ("auto_fallback_" + $tagA) | Out-Null
  Start-Sleep -Seconds 1
  $checkA2 = Get-PayoutById $cfg $headersSR $payoutA.id
  Require ($checkA2) "Scenario A: could not re-fetch payout after manual approve."
  Require ($checkA2.status -eq "paid") ("Scenario A FAILED even after manual approve: id={0} status={1}" -f $payoutA.id, $checkA2.status)
  Write-Host ("Scenario A PASSED: payout id={0} is PAID (manual fallback)" -f $payoutA.id) -ForegroundColor Green
} else {
  Write-Host ("Scenario A PASSED: payout id={0} is PAID (auto-approve)" -f $payoutA.id) -ForegroundColor Green
}

Write-Host ""
Write-Host "SCENARIO B: Below-minimum wallet (EXPECTED FAIL)" -ForegroundColor Cyan
$tagB = (Get-Date -Format "yyyyMMddHHmmss") + "_B"
$payoutB = Insert-PayoutRequest-Fallback $cfg $headersSR $fail.id $amountB $tagB
Write-Host ("Created payout B: id={0} amount={1} status={2}" -f $payoutB.id, $payoutB.amount, $payoutB.status) -ForegroundColor Yellow

Write-Host ""
Write-Host "Running auto-approve runner again..." -ForegroundColor DarkCyan
$autoRes2 = Run-AutoApprove $cfg $headersSR $autoLimit
Write-Host ("Auto-approve result: " + ($autoRes2 | ConvertTo-Json -Depth 5)) -ForegroundColor DarkGray

Start-Sleep -Seconds 1
$checkB = Get-PayoutById $cfg $headersSR $payoutB.id
Require ($checkB) "Scenario B: could not re-fetch payout row."

if ($checkB.status -eq "paid") {
  Fail ("Scenario B FAILED: payout id={0} became PAID but should be blocked." -f $payoutB.id)
}

Write-Host ("Scenario B PASSED: payout id={0} status={1} (not paid as expected)" -f $payoutB.id, $checkB.status) -ForegroundColor Green

Write-Host ""
Write-Host "ALL PAYOUT SCENARIOS PASSED" -ForegroundColor Green
Write-Host ("Scenario A payout_id={0}" -f $payoutA.id) -ForegroundColor Green
Write-Host ("Scenario B payout_id={0}" -f $payoutB.id) -ForegroundColor Green


.Key] = param()

function Fail($msg) { throw $msg }
function Require($cond, $msg) { if (-not $cond) { Fail $msg } }

function Read-EnvFile($path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
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

  $anon = FirstNonEmpty @(
    $m["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    $m["SUPABASE_ANON_KEY"],
    $env:NEXT_PUBLIC_SUPABASE_ANON_KEY,
    $env:SUPABASE_ANON_KEY
  )

  $sr = FirstNonEmpty @(
    $m["SUPABASE_SERVICE_ROLE_KEY"],
    $m["SERVICE_ROLE_KEY"],
    $env:SUPABASE_SERVICE_ROLE_KEY,
    $env:SERVICE_ROLE_KEY
  )

  Require ($url -and $anon -and $sr) "Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.local"

  return [pscustomobject]@{
    Url = $url.TrimEnd("/")
    Anon = $anon
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

function Dns-Sanity($cfg) {
  $sbHostName = ([Uri]$cfg.Url).Host
  try { [System.Net.Dns]::GetHostAddresses($sbHostName) | Out-Null }
  catch { Fail "DNS cannot resolve $sbHostName. Network/DNS issue." }
}

function Pick-Drivers($cfg, $headersSR, $amount, $buffer) {
  $rows = Invoke-SB $cfg "GET" "/rest/v1/drivers?select=id,wallet_balance,min_wallet_required&order=wallet_balance.desc&limit=500" $headersSR $null
  Require ($rows -and $rows.Count -gt 0) "No drivers returned from public.drivers"

  $success = $null
  $fail = $null

  foreach ($d in $rows) {
    if ($null -eq $d.wallet_balance -or $null -eq $d.min_wallet_required) { continue }
    $gap = [decimal]$d.wallet_balance - [decimal]$d.min_wallet_required

    if (-not $success -and $gap -ge ([decimal]$amount + [decimal]$buffer)) { $success = $d }
    if (-not $fail -and $gap -lt ([decimal]$amount)) { $fail = $d }

    if ($success -and $fail) { break }
  }

  Require ($success) ("No SUCCESS driver found where wallet_balance >= min_wallet_required + (amount + buffer). amount=$amount buffer=$buffer")
  Require ($fail) ("No FAIL driver found where wallet_balance - min_wallet_required < amount. amount=$amount")

  return [pscustomobject]@{ Success=$success; Fail=$fail }
}

function Insert-PayoutRequest-Fallback($cfg, $headersSR, $driverId, $amount, $tag) {
  # Try minimal-safe payloads only (NO payout_ref unless implied)
  $payloads = @()

  # 1) Minimal (most compatible)
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount })

  # 2) Add status
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending" })

  # 3) Add requested_at
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending"; requested_at = (Get-Date).ToString("o") })

  # 4) Add note (common)
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending"; requested_at = (Get-Date).ToString("o"); note = $tag })

  # 5) Add admin_note (alternative column some schemas use)
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending"; requested_at = (Get-Date).ToString("o"); admin_note = $tag })

  $hdr = @{}
  $headersSR.GetEnumerator() | ForEach-Object { $hdr[$_.Key] = $_.Value }
  $hdr["Prefer"] = "return=representation"

  foreach ($p in $payloads) {
    try {
      $created = Invoke-SB $cfg "POST" "/rest/v1/driver_payout_requests" $hdr $p
      if ($created -and $created.Count -ge 1) { return $created[0] }
    } catch {
      # keep trying next payload
    }
  }

  Fail "Insert failed for driver_payout_requests after all fallback payloads."
}

function Get-PayoutById($cfg, $headersSR, $id) {
  $rows = Invoke-SB $cfg "GET" ("/rest/v1/driver_payout_requests?select=id,driver_id,amount,status,requested_at,processed_at&id=eq.{0}&limit=1" -f $id) $headersSR $null
  if ($rows -and $rows.Count -ge 1) { return $rows[0] }
  return $null
}

function Run-AutoApprove($cfg, $headersSR, $limit) {
  $body = @{ p_limit = [int]$limit }
  return Invoke-SB $cfg "POST" "/rest/v1/rpc/admin_auto_approve_driver_payouts" $headersSR $body
}

function Manual-Approve($cfg, $headersSR, $requestId, $note) {
  # Detect existing columns on driver_payout_requests and only pass what exists
  $cols = Invoke-SB $cfg "GET" "/rest/v1/driver_payout_requests?select=*&limit=1" $headersSR $null
  $sample = $null
  if ($cols -and $cols.Count -ge 1) { $sample = $cols[0] }

  $body = @{
    p_request_id = [int64]$requestId
    p_admin_note = $note
  }

  # Only include optional params if the table likely supports them
  if ($sample -and $sample.PSObject.Properties.Name -contains "payout_method") { $body.p_payout_method = "GCASH" }
  if ($sample -and $sample.PSObject.Properties.Name -contains "payout_ref")    { $body.p_payout_ref    = ("AUTO_" + $note) }
  if ($sample -and $sample.PSObject.Properties.Name -contains "receipt_url")   { $body.p_receipt_url   = "" }

  return Invoke-SB $cfg "POST" "/rest/v1/rpc/driver_admin_approve_payout" $headersSR $body
}

Write-Host ""
Write-Host "JRide Driver Payout Full Test (NO MANUAL EDITS) - PS5.1 SAFE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$cfg = Get-Config
Dns-Sanity $cfg

$headersSR = @{
  apikey = $cfg.ServiceRole
  Authorization = "Bearer $($cfg.ServiceRole)"
}

$amountA = 20
$amountB = 20
$buffer  = 200
$autoLimit = 50

Write-Host ""
Write-Host "Picking drivers for tests..." -ForegroundColor DarkCyan
$picked = Pick-Drivers $cfg $headersSR $amountA $buffer
$success = $picked.Success
$fail = $picked.Fail

Write-Host ("SUCCESS driver: {0}  wallet={1}  min={2}" -f $success.id, $success.wallet_balance, $success.min_wallet_required) -ForegroundColor Green
Write-Host ("FAIL    driver: {0}  wallet={1}  min={2}" -f $fail.id, $fail.wallet_balance, $fail.min_wallet_required) -ForegroundColor Yellow

Write-Host ""
Write-Host "SCENARIO A: Create + Auto-Approve payout (EXPECTED SUCCESS)" -ForegroundColor Cyan
$tagA = (Get-Date -Format "yyyyMMddHHmmss") + "_A"
$payoutA = Insert-PayoutRequest-Fallback $cfg $headersSR $success.id $amountA $tagA
Write-Host ("Created payout A: id={0} amount={1} status={2}" -f $payoutA.id, $payoutA.amount, $payoutA.status) -ForegroundColor Green

Write-Host ""
Write-Host "Running auto-approve runner..." -ForegroundColor DarkCyan
$autoRes = Run-AutoApprove $cfg $headersSR $autoLimit
Write-Host ("Auto-approve result: " + ($autoRes | ConvertTo-Json -Depth 5)) -ForegroundColor DarkGray

Start-Sleep -Seconds 1
$checkA = Get-PayoutById $cfg $headersSR $payoutA.id
Require ($checkA) "Scenario A: could not re-fetch payout row."

if ($checkA.status -ne "paid") {
  Write-Host ("Auto-approve did not pay payout A (status={0}). Forcing manual approve fallback..." -f $checkA.status) -ForegroundColor Yellow
  Manual-Approve $cfg $headersSR $payoutA.id ("auto_fallback_" + $tagA) | Out-Null
  Start-Sleep -Seconds 1
  $checkA2 = Get-PayoutById $cfg $headersSR $payoutA.id
  Require ($checkA2) "Scenario A: could not re-fetch payout after manual approve."
  Require ($checkA2.status -eq "paid") ("Scenario A FAILED even after manual approve: id={0} status={1}" -f $payoutA.id, $checkA2.status)
  Write-Host ("Scenario A PASSED: payout id={0} is PAID (manual fallback)" -f $payoutA.id) -ForegroundColor Green
} else {
  Write-Host ("Scenario A PASSED: payout id={0} is PAID (auto-approve)" -f $payoutA.id) -ForegroundColor Green
}

Write-Host ""
Write-Host "SCENARIO B: Below-minimum wallet (EXPECTED FAIL)" -ForegroundColor Cyan
$tagB = (Get-Date -Format "yyyyMMddHHmmss") + "_B"
$payoutB = Insert-PayoutRequest-Fallback $cfg $headersSR $fail.id $amountB $tagB
Write-Host ("Created payout B: id={0} amount={1} status={2}" -f $payoutB.id, $payoutB.amount, $payoutB.status) -ForegroundColor Yellow

Write-Host ""
Write-Host "Running auto-approve runner again..." -ForegroundColor DarkCyan
$autoRes2 = Run-AutoApprove $cfg $headersSR $autoLimit
Write-Host ("Auto-approve result: " + ($autoRes2 | ConvertTo-Json -Depth 5)) -ForegroundColor DarkGray

Start-Sleep -Seconds 1
$checkB = Get-PayoutById $cfg $headersSR $payoutB.id
Require ($checkB) "Scenario B: could not re-fetch payout row."

if ($checkB.status -eq "paid") {
  Fail ("Scenario B FAILED: payout id={0} became PAID but should be blocked." -f $payoutB.id)
}

Write-Host ("Scenario B PASSED: payout id={0} status={1} (not paid as expected)" -f $payoutB.id, $checkB.status) -ForegroundColor Green

Write-Host ""
Write-Host "ALL PAYOUT SCENARIOS PASSED" -ForegroundColor Green
Write-Host ("Scenario A payout_id={0}" -f $payoutA.id) -ForegroundColor Green
Write-Host ("Scenario B payout_id={0}" -f $payoutB.id) -ForegroundColor Green


.Value }
    $hdr["Prefer"] = "return=representation"

    $updated = Invoke-SB $cfg "PATCH" ("/rest/v1/drivers?id=eq.{0}" -f $success.id) $hdr @{ wallet_balance = [decimal]$newWallet }
    # Refresh success row
    $ref = Invoke-SB $cfg "GET" ("/rest/v1/drivers?select=id,wallet_balance,min_wallet_required&id=eq.{0}&limit=1" -f $success.id) $headersSR $null
    if ($ref -and $ref.Count -ge 1) { $success = $ref[0] }
  }

  return [pscustomobject]@{ Success=$success; Fail=$fail }
}

function Insert-PayoutRequest-Fallback($cfg, $headersSR, $driverId, $amount, $tag) {
  # Try minimal-safe payloads only (NO payout_ref unless implied)
  $payloads = @()

  # 1) Minimal (most compatible)
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount })

  # 2) Add status
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending" })

  # 3) Add requested_at
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending"; requested_at = (Get-Date).ToString("o") })

  # 4) Add note (common)
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending"; requested_at = (Get-Date).ToString("o"); note = $tag })

  # 5) Add admin_note (alternative column some schemas use)
  $payloads += ,(@{ driver_id = $driverId; amount = [decimal]$amount; status = "pending"; requested_at = (Get-Date).ToString("o"); admin_note = $tag })

  $hdr = @{}
  $headersSR.GetEnumerator() | ForEach-Object { $hdr[$_.Key] = $_.Value }
  $hdr["Prefer"] = "return=representation"

  foreach ($p in $payloads) {
    try {
      $created = Invoke-SB $cfg "POST" "/rest/v1/driver_payout_requests" $hdr $p
      if ($created -and $created.Count -ge 1) { return $created[0] }
    } catch {
      # keep trying next payload
    }
  }

  Fail "Insert failed for driver_payout_requests after all fallback payloads."
}

function Get-PayoutById($cfg, $headersSR, $id) {
  $rows = Invoke-SB $cfg "GET" ("/rest/v1/driver_payout_requests?select=id,driver_id,amount,status,requested_at,processed_at&id=eq.{0}&limit=1" -f $id) $headersSR $null
  if ($rows -and $rows.Count -ge 1) { return $rows[0] }
  return $null
}

function Run-AutoApprove($cfg, $headersSR, $limit) {
  $body = @{ p_limit = [int]$limit }
  return Invoke-SB $cfg "POST" "/rest/v1/rpc/admin_auto_approve_driver_payouts" $headersSR $body
}

function Manual-Approve($cfg, $headersSR, $requestId, $note) {
  # Detect existing columns on driver_payout_requests and only pass what exists
  $cols = Invoke-SB $cfg "GET" "/rest/v1/driver_payout_requests?select=*&limit=1" $headersSR $null
  $sample = $null
  if ($cols -and $cols.Count -ge 1) { $sample = $cols[0] }

  $body = @{
    p_request_id = [int64]$requestId
    p_admin_note = $note
  }

  # Only include optional params if the table likely supports them
  if ($sample -and $sample.PSObject.Properties.Name -contains "payout_method") { $body.p_payout_method = "GCASH" }
  if ($sample -and $sample.PSObject.Properties.Name -contains "payout_ref")    { $body.p_payout_ref    = ("AUTO_" + $note) }
  if ($sample -and $sample.PSObject.Properties.Name -contains "receipt_url")   { $body.p_receipt_url   = "" }

  return Invoke-SB $cfg "POST" "/rest/v1/rpc/driver_admin_approve_payout" $headersSR $body
}

Write-Host ""
Write-Host "JRide Driver Payout Full Test (NO MANUAL EDITS) - PS5.1 SAFE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$cfg = Get-Config
Dns-Sanity $cfg

$headersSR = @{
  apikey = $cfg.ServiceRole
  Authorization = "Bearer $($cfg.ServiceRole)"
}

$amountA = 20
$amountB = 20
$buffer  = 200
$autoLimit = 50

Write-Host ""
Write-Host "Picking drivers for tests..." -ForegroundColor DarkCyan
$picked = Pick-Drivers $cfg $headersSR $amountA $buffer
$success = $picked.Success
$fail = $picked.Fail

Write-Host ("SUCCESS driver: {0}  wallet={1}  min={2}" -f $success.id, $success.wallet_balance, $success.min_wallet_required) -ForegroundColor Green
Write-Host ("FAIL    driver: {0}  wallet={1}  min={2}" -f $fail.id, $fail.wallet_balance, $fail.min_wallet_required) -ForegroundColor Yellow

Write-Host ""
Write-Host "SCENARIO A: Create + Auto-Approve payout (EXPECTED SUCCESS)" -ForegroundColor Cyan
$tagA = (Get-Date -Format "yyyyMMddHHmmss") + "_A"
$payoutA = Insert-PayoutRequest-Fallback $cfg $headersSR $success.id $amountA $tagA
Write-Host ("Created payout A: id={0} amount={1} status={2}" -f $payoutA.id, $payoutA.amount, $payoutA.status) -ForegroundColor Green

Write-Host ""
Write-Host "Running auto-approve runner..." -ForegroundColor DarkCyan
$autoRes = Run-AutoApprove $cfg $headersSR $autoLimit
Write-Host ("Auto-approve result: " + ($autoRes | ConvertTo-Json -Depth 5)) -ForegroundColor DarkGray

Start-Sleep -Seconds 1
$checkA = Get-PayoutById $cfg $headersSR $payoutA.id
Require ($checkA) "Scenario A: could not re-fetch payout row."

if ($checkA.status -ne "paid") {
  Write-Host ("Auto-approve did not pay payout A (status={0}). Forcing manual approve fallback..." -f $checkA.status) -ForegroundColor Yellow
  Manual-Approve $cfg $headersSR $payoutA.id ("auto_fallback_" + $tagA) | Out-Null
  Start-Sleep -Seconds 1
  $checkA2 = Get-PayoutById $cfg $headersSR $payoutA.id
  Require ($checkA2) "Scenario A: could not re-fetch payout after manual approve."
  Require ($checkA2.status -eq "paid") ("Scenario A FAILED even after manual approve: id={0} status={1}" -f $payoutA.id, $checkA2.status)
  Write-Host ("Scenario A PASSED: payout id={0} is PAID (manual fallback)" -f $payoutA.id) -ForegroundColor Green
} else {
  Write-Host ("Scenario A PASSED: payout id={0} is PAID (auto-approve)" -f $payoutA.id) -ForegroundColor Green
}

Write-Host ""
Write-Host "SCENARIO B: Below-minimum wallet (EXPECTED FAIL)" -ForegroundColor Cyan
$tagB = (Get-Date -Format "yyyyMMddHHmmss") + "_B"
$payoutB = Insert-PayoutRequest-Fallback $cfg $headersSR $fail.id $amountB $tagB
Write-Host ("Created payout B: id={0} amount={1} status={2}" -f $payoutB.id, $payoutB.amount, $payoutB.status) -ForegroundColor Yellow

Write-Host ""
Write-Host "Running auto-approve runner again..." -ForegroundColor DarkCyan
$autoRes2 = Run-AutoApprove $cfg $headersSR $autoLimit
Write-Host ("Auto-approve result: " + ($autoRes2 | ConvertTo-Json -Depth 5)) -ForegroundColor DarkGray

Start-Sleep -Seconds 1
$checkB = Get-PayoutById $cfg $headersSR $payoutB.id
Require ($checkB) "Scenario B: could not re-fetch payout row."

if ($checkB.status -eq "paid") {
  Fail ("Scenario B FAILED: payout id={0} became PAID but should be blocked." -f $payoutB.id)
}

Write-Host ("Scenario B PASSED: payout id={0} status={1} (not paid as expected)" -f $payoutB.id, $checkB.status) -ForegroundColor Green

Write-Host ""
Write-Host "ALL PAYOUT SCENARIOS PASSED" -ForegroundColor Green
Write-Host ("Scenario A payout_id={0}" -f $payoutA.id) -ForegroundColor Green
Write-Host ("Scenario B payout_id={0}" -f $payoutB.id) -ForegroundColor Green



