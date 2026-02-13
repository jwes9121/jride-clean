<#  SMOKETEST-JRIDE_PASSENGER_BOOKING_FLOW_V4_3_PS5SAFE.ps1
    JRide Smoke Test: Passenger Booking Flow (V4.3 / PS5-safe)

    Purpose:
    - Fix blind 400s by printing the response body even when Invoke-WebRequest throws.
    - Auto-try common login payload shapes to match your backend contract.

    Steps:
    0) Server reachable
    1) Login (POST /api/public/auth/login) - tries multiple payload variants
    2) Session check (GET /api/public/auth/session)
    3) Can-book check (GET /api/public/passenger/can-book)
#>

param(
  [string]$BaseUrl = "http://localhost:3000",
  [Parameter(Mandatory=$true)][string]$PhoneOrEmail,
  [Parameter(Mandatory=$true)][string]$Password
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }

function JoinUrl([string]$base, [string]$path) {
  if ($base.EndsWith("/")) { $base = $base.TrimEnd("/") }
  if (-not $path.StartsWith("/")) { $path = "/" + $path }
  return $base + $path
}

function TryJson($text) {
  try { return ($text | ConvertFrom-Json) } catch { return $null }
}

function ReadWebExceptionBody($ex) {
  try {
    $resp = $ex.Response
    if ($null -eq $resp) { return "" }

    $stream = $resp.GetResponseStream()
    if ($null -eq $stream) { return "" }

    $reader = New-Object System.IO.StreamReader($stream)
    $text = $reader.ReadToEnd()
    $reader.Close()
    return $text
  } catch {
    return ""
  }
}

function InvokeJson([string]$Url, [string]$Method, $WebSession, [string]$BodyJson) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method $Method -WebSession $WebSession `
      -Headers @{ "Content-Type" = "application/json" } -Body $BodyJson -TimeoutSec 30
    return @{
      ok = $true
      status = [int]$r.StatusCode
      text = ($r.Content | Out-String)
    }
  } catch {
    $ex = $_.Exception
    $body = ReadWebExceptionBody $ex
    # best-effort status
    $status = $null
    try { if ($ex.Response -and $ex.Response.StatusCode) { $status = [int]$ex.Response.StatusCode } } catch {}
    return @{
      ok = $false
      status = $status
      text = $body
      message = $ex.Message
    }
  }
}

Write-Host ""
Write-Host "== JRide Smoke Test: Passenger Booking Flow (V4.3 / PS5-safe) ==" -ForegroundColor Cyan
Ok ("[OK] BaseUrl: {0}" -f $BaseUrl)

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# --- STEP 0: Server reachable ---
$healthUrl = JoinUrl $BaseUrl "/api/public/auth/session"
try {
  $null = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -Method GET -WebSession $session -TimeoutSec 20
  Ok ("[OK] Server reachable: {0}" -f $healthUrl)
} catch {
  Fail ("[FAIL] Server not reachable: {0}" -f $healthUrl)
  throw
}

# --- STEP 1: Login (auto-try variants) ---
Write-Host ""
Write-Host "== STEP 1: POST /api/public/auth/login (auto-try payload variants) ==" -ForegroundColor Cyan

$loginUrl = JoinUrl $BaseUrl "/api/public/auth/login"
$id = $PhoneOrEmail.Trim()

# Build payload variants (common contracts)
$variants = @()

# 1) phoneOrEmail/password (your older scripts used this)
$variants += @{
  name = "phoneOrEmail/password"
  body = @{ phoneOrEmail = $id; password = $Password }
}

# 2) phone/password
$variants += @{
  name = "phone/password"
  body = @{ phone = $id; password = $Password }
}

# 3) email/password
$variants += @{
  name = "email/password"
  body = @{ email = $id; password = $Password }
}

# 4) identifier/password
$variants += @{
  name = "identifier/password"
  body = @{ identifier = $id; password = $Password }
}

# 5) username/password
$variants += @{
  name = "username/password"
  body = @{ username = $id; password = $Password }
}

# If it looks like an email, try email earlier by reordering
if ($id -match "@") {
  $variants = @(
    ($variants | Where-Object { $_.name -eq "email/password" }),
    ($variants | Where-Object { $_.name -ne "email/password" })
  ) | ForEach-Object { $_ }
}

$loginSucceeded = $false
$loginWinner = $null

foreach ($v in $variants) {
  $bodyJson = ($v.body | ConvertTo-Json -Depth 5)
  Write-Host ("-- trying: {0}" -f $v.name) -ForegroundColor DarkCyan

  $res = InvokeJson -Url $loginUrl -Method "POST" -WebSession $session -BodyJson $bodyJson

  if ($res.ok -eq $true -and $res.status -ge 200 -and $res.status -lt 300) {
    Ok ("[OK] Login HTTP {0} using {1}" -f $res.status, $v.name)
    $loginSucceeded = $true
    $loginWinner = $v.name
    $t = $res.text
    $j = TryJson $t
    if ($j -ne $null) { Write-Host ($t) } else { Write-Host ($t) }
    break
  } else {
    Warn ("[WARN] Login failed using {0}. HTTP={1}" -f $v.name, ($res.status -as [string]))
    if ($res.text -and $res.text.Trim().Length -gt 0) {
      Write-Host "---- response body (important) ----" -ForegroundColor Yellow
      Write-Host $res.text
      Write-Host "-----------------------------------" -ForegroundColor Yellow
    } else {
      Write-Host ("(no response body; message={0})" -f $res.message) -ForegroundColor Yellow
    }
  }
}

if (-not $loginSucceeded) {
  Fail "[FAIL] All login payload variants failed. The response body above tells us the expected schema."
  throw "LOGIN_ALL_VARIANTS_FAILED"
}

# --- STEP 2: Session check ---
Write-Host ""
Write-Host "== STEP 2: GET /api/public/auth/session ==" -ForegroundColor Cyan

$sessionUrl = JoinUrl $BaseUrl "/api/public/auth/session"
$s2 = Invoke-WebRequest -UseBasicParsing -Uri $sessionUrl -Method GET -WebSession $session -TimeoutSec 20
$s2Text = ($s2.Content | Out-String)
$s2Json = TryJson $s2Text

if ($s2Json -eq $null) {
  Warn "[WARN] Session response not JSON:"
  Write-Host $s2Text
  throw "SESSION_NOT_JSON"
}

if ($s2Json.authed -ne $true) {
  Fail "[FAIL] Session says authed=false (cookies not set/kept)."
  Write-Host $s2Text
  throw "SESSION_NOT_AUTHED"
}

Ok ("[OK] Session authed=true (login variant: {0})" -f $loginWinner)
Write-Host $s2Text

# --- STEP 3: Can-book check ---
Write-Host ""
Write-Host "== STEP 3: GET /api/public/passenger/can-book ==" -ForegroundColor Cyan

$canBookUrl = JoinUrl $BaseUrl "/api/public/passenger/can-book"
$cb = Invoke-WebRequest -UseBasicParsing -Uri $canBookUrl -Method GET -WebSession $session -TimeoutSec 20
$cbText = ($cb.Content | Out-String)
Ok ("[OK] can-book HTTP {0}" -f $cb.StatusCode)
Write-Host $cbText

Write-Host ""
Ok "[OK] DONE."
