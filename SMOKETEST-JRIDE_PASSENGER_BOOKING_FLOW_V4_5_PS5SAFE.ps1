<#  SMOKETEST-JRIDE_PASSENGER_BOOKING_FLOW_V4_5_PS5SAFE.ps1
    JRide Smoke Test: Passenger Booking Flow (V4.5 / PS5-safe)

    - Auto-tries login payload variants (phone/email)
    - Verifies session + can-book
    - If -DoBook, auto-tries booking payload variants until one works
    - Prints error bodies (400/401/500) so we align schema without guessing
#>

param(
  [string]$BaseUrl = "http://localhost:3000",
  [Parameter(Mandatory=$true)][string]$PhoneOrEmail,
  [Parameter(Mandatory=$true)][string]$Password,
  [switch]$DoBook,

  # Booking defaults
  [string]$Town = "Lagawe",
  [string]$VehicleType = "tricycle",
  [int]$Passengers = 1,
  [string]$PassengerName = "Test Passenger A",

  [string]$PickupLabel = "Lagawe Town Proper",
  [double]$PickupLat = 16.801351,
  [double]$PickupLng = 121.124289,

  [string]$DropoffLabel = "Lagawe Town Proper",
  [double]$DropoffLat = 16.801351,
  [double]$DropoffLng = 121.124289
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

function TryJson($text) { try { return ($text | ConvertFrom-Json) } catch { return $null } }

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
  } catch { return "" }
}

function InvokeJson([string]$Url, [string]$Method, $WebSession, [string]$BodyJson) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method $Method -WebSession $WebSession `
      -Headers @{ "Content-Type" = "application/json" } -Body $BodyJson -TimeoutSec 30
    return @{ ok=$true; status=[int]$r.StatusCode; text=($r.Content | Out-String) }
  } catch {
    $ex = $_.Exception
    $body = ReadWebExceptionBody $ex
    $status = $null
    try { if ($ex.Response -and $ex.Response.StatusCode) { $status = [int]$ex.Response.StatusCode } } catch {}
    return @{ ok=$false; status=$status; text=$body; message=$ex.Message }
  }
}

Write-Host ""
Write-Host "== JRide Smoke Test: Passenger Booking Flow (V4.5 / PS5-safe) ==" -ForegroundColor Cyan
Ok ("[OK] BaseUrl: {0}" -f $BaseUrl)

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# STEP 0: reachability
$healthUrl = JoinUrl $BaseUrl "/api/public/auth/session"
$null = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -Method GET -WebSession $session -TimeoutSec 20
Ok ("[OK] Server reachable: {0}" -f $healthUrl)

# STEP 1: LOGIN (auto-try)
Write-Host ""
Write-Host "== STEP 1: POST /api/public/auth/login (auto-try) ==" -ForegroundColor Cyan

$loginUrl = JoinUrl $BaseUrl "/api/public/auth/login"
$id = $PhoneOrEmail.Trim()

$loginVariants = @(
  @{ name="phoneOrEmail/password"; body=@{ phoneOrEmail=$id; password=$Password } },
  @{ name="phone/password";       body=@{ phone=$id;        password=$Password } },
  @{ name="email/password";       body=@{ email=$id;        password=$Password } },
  @{ name="identifier/password";  body=@{ identifier=$id;   password=$Password } },
  @{ name="username/password";    body=@{ username=$id;     password=$Password } }
)

$loginSucceeded = $false
$loginWinner = $null

foreach ($v in $loginVariants) {
  Write-Host ("-- trying: {0}" -f $v.name) -ForegroundColor DarkCyan
  $bodyJson = ($v.body | ConvertTo-Json -Depth 6)
  $res = InvokeJson -Url $loginUrl -Method "POST" -WebSession $session -BodyJson $bodyJson

  if ($res.ok -and $res.status -ge 200 -and $res.status -lt 300) {
    Ok ("[OK] Login HTTP {0} using {1}" -f $res.status, $v.name)
    $loginSucceeded = $true
    $loginWinner = $v.name
    Write-Host $res.text
    break
  } else {
    Warn ("[WARN] Login failed using {0}. HTTP={1}" -f $v.name, ($res.status -as [string]))
    if ($res.text -and $res.text.Trim().Length -gt 0) {
      Write-Host "---- response body ----" -ForegroundColor Yellow
      Write-Host $res.text
      Write-Host "-----------------------" -ForegroundColor Yellow
    }
  }
}

if (-not $loginSucceeded) { throw "LOGIN_ALL_VARIANTS_FAILED" }

# STEP 2: SESSION
Write-Host ""
Write-Host "== STEP 2: GET /api/public/auth/session ==" -ForegroundColor Cyan

$sessionUrl = JoinUrl $BaseUrl "/api/public/auth/session"
$s2 = Invoke-WebRequest -UseBasicParsing -Uri $sessionUrl -Method GET -WebSession $session -TimeoutSec 20
$s2Text = ($s2.Content | Out-String)
$s2Json = TryJson $s2Text
if ($null -eq $s2Json -or $s2Json.authed -ne $true) { throw "SESSION_NOT_AUTHED" }
Ok ("[OK] Session authed=true (login variant: {0})" -f $loginWinner)
Write-Host $s2Text

# STEP 3: CAN-BOOK
Write-Host ""
Write-Host "== STEP 3: GET /api/public/passenger/can-book ==" -ForegroundColor Cyan

$canBookUrl = JoinUrl $BaseUrl "/api/public/passenger/can-book"
$cb = Invoke-WebRequest -UseBasicParsing -Uri $canBookUrl -Method GET -WebSession $session -TimeoutSec 20
$cbText = ($cb.Content | Out-String)
Ok ("[OK] can-book HTTP {0}" -f $cb.StatusCode)
Write-Host $cbText

# STEP 4: BOOK (auto-try GEO variants)
if ($DoBook) {
  Write-Host ""
  Write-Host "== STEP 4: POST /api/public/passenger/book (auto-try GEO variants) ==" -ForegroundColor Cyan

  $bookUrl = JoinUrl $BaseUrl "/api/public/passenger/book"

  # Common base fields
  $base = @{
    town          = $Town
    vehicleType   = $VehicleType
    passengers    = $Passengers
    passengerName = $PassengerName
    pickupLabel   = $PickupLabel
    dropoffLabel  = $DropoffLabel
  }

  # Booking variants (try different key shapes)
  $bookVariants = @(
    # A) original nested pickup/dropoff
    @{ name="pickup/dropoff objects"; body = ($base + @{
      pickup  = @{ label=$PickupLabel;  lat=$PickupLat;  lng=$PickupLng }
      dropoff = @{ label=$DropoffLabel; lat=$DropoffLat; lng=$DropoffLng }
    })},

    # B) geo wrapper
    @{ name="geo wrapper"; body = ($base + @{
      geo = @{
        pickup  = @{ lat=$PickupLat;  lng=$PickupLng;  label=$PickupLabel }
        dropoff = @{ lat=$DropoffLat; lng=$DropoffLng; label=$DropoffLabel }
      }
    })},

    # C) flat pickup_* dropoff_*
    @{ name="flat pickup_lat/lng"; body = ($base + @{
      pickup_lat  = $PickupLat
      pickup_lng  = $PickupLng
      dropoff_lat = $DropoffLat
      dropoff_lng = $DropoffLng
      pickup_label  = $PickupLabel
      dropoff_label = $DropoffLabel
    })},

    # D) from/to objects
    @{ name="from/to objects"; body = ($base + @{
      from = @{ lat=$PickupLat;  lng=$PickupLng;  label=$PickupLabel }
      to   = @{ lat=$DropoffLat; lng=$DropoffLng; label=$DropoffLabel }
    })},

    # E) origin/destination objects
    @{ name="origin/destination"; body = ($base + @{
      origin      = @{ lat=$PickupLat;  lng=$PickupLng;  label=$PickupLabel }
      destination = @{ lat=$DropoffLat; lng=$DropoffLng; label=$DropoffLabel }
    })},

    # F) coordinate strings
    @{ name="pickup/dropoff coord strings"; body = ($base + @{
      pickup_coords  = ("{0},{1}" -f $PickupLat, $PickupLng)
      dropoff_coords = ("{0},{1}" -f $DropoffLat, $DropoffLng)
      pickup_label   = $PickupLabel
      dropoff_label  = $DropoffLabel
    })}
  )

  $bookSucceeded = $false

  foreach ($v in $bookVariants) {
    Write-Host ("-- trying book payload: {0}" -f $v.name) -ForegroundColor DarkCyan
    $bookJson = ($v.body | ConvertTo-Json -Depth 10)
    $bk = InvokeJson -Url $bookUrl -Method "POST" -WebSession $session -BodyJson $bookJson

    if ($bk.ok -and $bk.status -ge 200 -and $bk.status -lt 300) {
      Ok ("[OK] book HTTP {0} using {1}" -f $bk.status, $v.name)
      Write-Host $bk.text
      $bookSucceeded = $true
      break
    } else {
      Warn ("[WARN] book failed using {0}. HTTP={1}" -f $v.name, ($bk.status -as [string]))
      if ($bk.text -and $bk.text.Trim().Length -gt 0) {
        Write-Host "---- response body ----" -ForegroundColor Yellow
        Write-Host $bk.text
        Write-Host "-----------------------" -ForegroundColor Yellow
      }
    }
  }

  if (-not $bookSucceeded) {
    Fail "[FAIL] All booking GEO variants failed. The last response body tells us the exact required shape."
    throw "BOOK_ALL_VARIANTS_FAILED"
  }
}

Write-Host ""
Ok "[OK] DONE."
