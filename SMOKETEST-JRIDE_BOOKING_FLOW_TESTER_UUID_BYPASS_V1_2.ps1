# SMOKETEST-JRIDE_BOOKING_FLOW_TESTER_UUID_BYPASS_V1_2.ps1
# PS5-safe. Auto-detects BOOKING CREATE endpoint by requiring:
# - export async function POST
# - .from("bookings") AND .insert(
# Then creates booking, assigns to tester, sets status accepted, polls active-trip.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

function Nz([object]$v, [string]$fallback) {
  if ($null -eq $v) { return $fallback }
  $s = [string]$v
  if ([string]::IsNullOrWhiteSpace($s)) { return $fallback }
  return $s
}

# ---- CONFIG ----
$BaseUrl = $env:JRIDE_BASE_URL
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = "https://app.jride.net" }

$TesterDriverId = "00000000-0000-4000-8000-000000000001"

# Lamut-ish coords (safe defaults)
$PickupLat  = 16.7369
$PickupLng  = 121.1526
$DropLat    = 16.6930
$DropLng    = 121.1740

$AdminToken = $env:JRIDE_ADMIN_TOKEN

function ToApiPathFromRouteTs([string]$fullPath, [string]$repoRoot){
  $p = $fullPath.Substring($repoRoot.Length).TrimStart('\','/')
  $p = $p -replace '^app[\\/]+api[\\/]+', ''
  $p = $p -replace '[\\/]+route\.ts$', ''
  $p = $p -replace '\\','/'
  return ("/api/" + $p)
}

function InvokeJson([string]$method, [string]$url, [object]$body){
  $headers = @{
    "Content-Type" = "application/json"
    "x-jride-test" = "1"
    "x-jride-bypass-wallet" = "1"
    "x-jride-bypass-night-gate" = "1"
    "x-jride-bypass-location" = "1"
  }
  if (-not [string]::IsNullOrWhiteSpace($AdminToken)) {
    $headers["Authorization"] = ("Bearer " + $AdminToken)
  }

  $json = $null
  if ($body -ne $null) { $json = ($body | ConvertTo-Json -Depth 12) }

  try {
    if ($method -eq "GET") {
      return Invoke-RestMethod -Method Get -Uri $url -Headers $headers -TimeoutSec 30
    } else {
      return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -Body $json -TimeoutSec 30
    }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.GetResponseStream()) {
      $sr = New-Object IO.StreamReader($resp.GetResponseStream())
      $txt = $sr.ReadToEnd()
      Warn "[HTTP ERROR BODY]"
      Write-Host $txt
      return $null
    }
    throw
  }
}

Info "== JRIDE SmokeTest: Booking -> Assign -> Accept (Tester UUID) =="
Info ("BaseUrl: " + $BaseUrl)
Info ("TesterDriverId: " + $TesterDriverId)

# ---- 1) Auto-detect booking CREATE endpoints ----
$RepoRoot = (Get-Location).Path
$ApiRoot = Join-Path $RepoRoot "app\api"
if (-not (Test-Path -LiteralPath $ApiRoot)) { Die "[FAIL] app\api not found. Run from Next.js repo root." }

$routeFiles = Get-ChildItem -LiteralPath $ApiRoot -Recurse -File -Filter "route.ts"

$candidates = @()
foreach ($f in $routeFiles) {
  $t = ""
  try { $t = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 } catch { continue }

  if ($t -notmatch 'export\s+async\s+function\s+POST') { continue }

  # Strong requirement: INSERT into bookings table
  $hasBookingsInsert =
    ($t -match '\.from\(\s*["'']bookings["'']\s*\)\s*\.insert\s*\(') -or
    ($t -match 'from\(\s*["'']bookings["'']\s*\)[\s\S]{0,400}?\.insert\s*\(')

  if (-not $hasBookingsInsert) { continue }

  $score = 0
  if ($t -match 'ride' -or $f.FullName -match 'ride') { $score += 2 }
  if ($t -match 'request' -or $f.FullName -match 'request') { $score += 2 }
  if ($t -match 'passenger' -or $f.FullName -match 'passenger') { $score += 1 }
  if ($t -match 'pickup' -or $t -match 'dropoff') { $score += 1 }
  if ($f.FullName -match 'dispatch') { $score -= 2 } # avoid dispatch routes
  if ($f.FullName -match 'admin') { $score -= 2 }    # avoid admin-only creators

  $candidates += [pscustomobject]@{ Score=$score; File=$f.FullName }
}

if (-not $candidates -or $candidates.Count -eq 0) {
  Die "[FAIL] Could not find any booking CREATE endpoint (POST + from(bookings).insert())."
}

$candidates = $candidates | Sort-Object -Property @{Expression="Score"; Descending=$true}, @{Expression="File"; Descending=$false}
Info "== Booking create candidates (top 8) =="
$candidates | Select-Object -First 8 | ForEach-Object { Info ("Score {0}  {1}" -f $_.Score, $_.File) }

# ---- 2) Try up to 3 booking-create endpoints until one succeeds ----
$bookingBody = @{
  test_mode = $true
  bypass_wallet = $true
  bypass_night_gate = $true
  bypass_location = $true

  pickup = @{ lat = $PickupLat; lng = $PickupLng; label = "Lamut (test pickup)" }
  dropoff = @{ lat = $DropLat; lng = $DropLng; label = "Lamut (test dropoff)" }

  town = "Lamut"
  notes = "SMOKETEST tester uuid; bypass wallet/night/location"
  service = "ride"
}

$createRes = $null
$bookingApiPath = $null

for ($i=0; $i -lt [Math]::Min(3, $candidates.Count); $i++) {
  $file = $candidates[$i].File
  $path = ToApiPathFromRouteTs -fullPath $file -repoRoot $RepoRoot
  $url = $BaseUrl + $path
  Info ""
  Info ("== Trying booking create endpoint #{0}: {1}" -f ($i+1), $url)

  $r = InvokeJson -method "POST" -url $url -body $bookingBody
  if ($null -ne $r) {
    $createRes = $r
    $bookingApiPath = $path
    break
  }
}

if ($null -eq $createRes) {
  Die "[FAIL] All booking create candidates returned errors. Paste the last HTTP ERROR BODY shown."
}

Ok ("[OK] Booking created via: " + $bookingApiPath)
Info ($createRes | ConvertTo-Json -Depth 12)

# Extract booking id/code
$bookingId = $null
$bookingCode = $null

foreach ($k in @("booking_id","id","bookingId")) {
  if ($createRes.PSObject.Properties.Name -contains $k) { $bookingId = [string]$createRes.$k; break }
}
foreach ($k in @("booking_code","code","bookingCode")) {
  if ($createRes.PSObject.Properties.Name -contains $k) { $bookingCode = [string]$createRes.$k; break }
}
if (-not $bookingId -and $createRes.booking) {
  $b = $createRes.booking
  if ($b.id) { $bookingId = [string]$b.id }
  if ($b.booking_code) { $bookingCode = [string]$b.booking_code }
}

if (-not $bookingId -and -not $bookingCode) {
  Die "[FAIL] Could not extract booking id/code from create response."
}

Ok ("[OK] bookingId: " + (Nz $bookingId "<null>"))
Ok ("[OK] bookingCode: " + (Nz $bookingCode "<null>"))

# ---- 3) Assign to tester driver ----
$assignUrl = ($BaseUrl + "/api/dispatch/assign")
$assignBody = @{
  booking_id = $bookingId
  booking_code = $bookingCode
  driver_id = $TesterDriverId
  assigned_driver_id = $TesterDriverId
  test_mode = $true
}
Info "== Assigning to tester driver =="
$assignRes = InvokeJson -method "POST" -url $assignUrl -body $assignBody
if ($null -eq $assignRes) { Die "[FAIL] Assign failed (see HTTP ERROR BODY above)." }
Info ($assignRes | ConvertTo-Json -Depth 12)

# ---- 4) Status -> accepted ----
$statUrl = ($BaseUrl + "/api/dispatch/status")
$statBody = @{
  booking_id = $bookingId
  booking_code = $bookingCode
  status = "accepted"
  test_mode = $true
}
Info "== Setting status -> accepted =="
$statRes = InvokeJson -method "POST" -url $statUrl -body $statBody
if ($null -eq $statRes) { Die "[FAIL] dispatch/status failed (see HTTP ERROR BODY above)." }
Info ($statRes | ConvertTo-Json -Depth 12)

# ---- 5) Poll active-trip ----
$pollUrl = ($BaseUrl + "/api/driver/active-trip?driver_id=" + $TesterDriverId)
Info "== Polling active-trip (up to 10 tries) =="
for ($k=1; $k -le 10; $k++) {
  Start-Sleep -Seconds 2
  $poll = InvokeJson -method "GET" -url $pollUrl -body $null
  if ($null -eq $poll) { continue }
  $st = $null
  try { $st = [string]$poll.trip.status } catch { $st = $null }
  Info ("Try {0}: status={1}" -f $k, (Nz $st "<null>"))
  if ($st -eq "accepted") {
    Ok "[OK] Driver active-trip is ACCEPTED (correct)."
    break
  }
}

Ok "== SMOKETEST DONE =="
