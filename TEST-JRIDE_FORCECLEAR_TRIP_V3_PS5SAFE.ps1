param(
  [string]$BaseUrl = "https://app.jride.net",
  [Parameter(Mandatory=$true)][string]$BookingCode
)

function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }

function Invoke-PostJsonWithBody([string]$Url, [string]$JsonBody) {
  Info ("POST {0}" -f $Url)
  Info ("BODY {0}" -f $JsonBody)

  try {
    $resp = Invoke-RestMethod -Method Post -Uri $Url -ContentType "application/json" -Body $JsonBody
    return @{ ok=$true; statusCode=200; body=($resp | ConvertTo-Json -Depth 20) }
  } catch {
    $ex = $_.Exception
    $code = $null
    try { $code = [int]$ex.Response.StatusCode } catch { $code = $null }

    $raw = $null
    try {
      if ($ex.Response -and $ex.Response.GetResponseStream()) {
        $sr = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
        $raw = $sr.ReadToEnd()
      }
    } catch { $raw = $null }

    $codeText = "???"
    if ($code -ne $null) { $codeText = [string]$code }

    Warn ("FAILED HTTP {0}: {1}" -f $codeText, $ex.Message)
    if ($raw) { Warn ("RESPONSE BODY: {0}" -f $raw) }

    return @{ ok=$false; statusCode=$code; body=$raw }
  }
}

function TryStatus([string]$status) {
  $url = "$BaseUrl/api/dispatch/status"
  $body = @{ bookingCode = $BookingCode; status = $status } | ConvertTo-Json -Compress
  $r = Invoke-PostJsonWithBody $url $body

  if ($r.ok) {
    Ok ("ACCEPTED: {0}" -f $status)
    return $true
  }

  if ($r.statusCode -eq 409) {
    Warn ("409 Conflict on status '{0}' (transition blocked). Continuing..." -f $status)
    return $false
  }

  if ($r.statusCode -eq 400) {
    Warn ("400 Bad Request on '{0}'. (Check enum/validation) Continuing..." -f $status)
    return $false
  }

  if ($r.statusCode -eq 404) {
    Fail "404 Not Found: booking code not found."
  }

  Fail ("Stop: unexpected HTTP {0} on status '{1}'." -f $r.statusCode, $status)
}

Info ("BaseUrl:     {0}" -f $BaseUrl)
Info ("BookingCode: {0}" -f $BookingCode)

# First: try to cancel directly
Info "Step 1: Try direct cancel..."
$didCancel = TryStatus "cancelled"
if ($didCancel) { Ok "DONE (cancelled)."; exit 0 }

# Second: try to complete directly (sometimes cancel is blocked but complete is allowed)
Info "Step 2: Try direct complete..."
$didComplete = TryStatus "completed"
if ($didComplete) { Ok "DONE (completed)."; exit 0 }

# Third: walk forward through valid lifecycle states, and after each step try cancel again.
# Allowed set (from your server): requested, assigned, accepted, fare_proposed, on_the_way, arrived, enroute, on_trip, completed, cancelled
$flow = @("requested","assigned","accepted","fare_proposed","on_the_way","arrived","enroute","on_trip")

Info "Step 3: Walk forward and attempt cancel..."
foreach ($s in $flow) {
  $null = TryStatus $s

  # after moving forward (or if already past), try cancelling again
  $didCancel = TryStatus "cancelled"
  if ($didCancel) { Ok "DONE (cancelled)."; exit 0 }
}

Info "Step 4: Final attempt to complete..."
$didComplete = TryStatus "completed"
if ($didComplete) { Ok "DONE (completed)."; exit 0 }

Fail "Unable to cancel/complete. The 409 RESPONSE BODY above should tell us the exact required transition."
