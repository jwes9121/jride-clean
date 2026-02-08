# DIAG-JRIDE_PROD_ASSIGN_POST_404_FINGERPRINT_V1.ps1
# PS5-safe: POST to /api/dispatch/assign and print status + key headers + body

$ErrorActionPreference = "Stop"

$Url = "https://app.jride.net/api/dispatch/assign"

# minimal harmless payload (should return 400 if route exists)
$BodyObj = @{ bookingCode = "TEST"; driverId = "00000000-0000-0000-0000-000000000000" }
$BodyJson = ($BodyObj | ConvertTo-Json -Depth 10)

Write-Host "== JRIDE DIAG: POST /api/dispatch/assign fingerprint ==" -ForegroundColor Cyan
Write-Host "URL: $Url" -ForegroundColor Green

try {
  $res = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Url -ContentType "application/json" -Body $BodyJson -Headers @{
    "Accept"="application/json"
    "cache-control"="no-cache"
  }

  Write-Host ("StatusCode: " + $res.StatusCode) -ForegroundColor Green
  Write-Host "---- HEADERS ----" -ForegroundColor Cyan
  $res.Headers.GetEnumerator() | Sort-Object Name | ForEach-Object {
    if ($_.Name -match "x-|server|date|location|content-type|cache") {
      "{0}: {1}" -f $_.Name, $_.Value
    }
  } | Write-Host

  Write-Host "---- BODY ----" -ForegroundColor Cyan
  $res.Content | Write-Host

} catch {
  $resp = $_.Exception.Response
  if ($resp -eq $null) {
    Write-Host ("[FAIL] " + $_.Exception.Message) -ForegroundColor Red
    exit 1
  }

  $code = $resp.StatusCode.value__
  Write-Host ("StatusCode: " + $code) -ForegroundColor Yellow

  Write-Host "---- HEADERS ----" -ForegroundColor Cyan
  try {
    $resp.Headers.AllKeys | Sort-Object | ForEach-Object {
      $k = $_
      if ($k -match "x-|server|date|location|content-type|cache") {
        "{0}: {1}" -f $k, $resp.Headers[$k]
      }
    } | Write-Host
  } catch {}

  Write-Host "---- BODY ----" -ForegroundColor Cyan
  try {
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $body = $sr.ReadToEnd()
    $body | Write-Host
  } catch {
    Write-Host "(no readable body)" -ForegroundColor DarkGray
  }

  exit 0
}
