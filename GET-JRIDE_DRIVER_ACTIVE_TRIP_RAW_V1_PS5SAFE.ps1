# GET-JRIDE_DRIVER_ACTIVE_TRIP_RAW_V1_PS5SAFE.ps1
# PS5-safe: prints status code + raw JSON from the same endpoint the driver APK uses.

$ErrorActionPreference = "Stop"

$BASE_URL  = "https://app.jride.net"
$DRIVER_ID = "d41bf199-96c6-4022-8a3d-09ab9dbd270f"

$url = $BASE_URL.TrimEnd("/") + "/api/driver/active-trip?driver_id=" + [uri]::EscapeDataString($DRIVER_ID)

Write-Host "== JRIDE RAW GET ==" -ForegroundColor Cyan
Write-Host "URL: $url" -ForegroundColor Green

try {
  $res = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $url -Headers @{ "Accept"="application/json"; "cache-control"="no-cache" }
  Write-Host ("StatusCode: " + $res.StatusCode) -ForegroundColor Green
  Write-Host "---- BODY START ----" -ForegroundColor Cyan
  $res.Content | Write-Host
  Write-Host "---- BODY END ----" -ForegroundColor Cyan
} catch {
  Write-Host ("[FAIL] " + $_.Exception.Message) -ForegroundColor Red
  if ($_.Exception.Response -ne $null) {
    try {
      $code = $_.Exception.Response.StatusCode.value__
      Write-Host ("HTTP Status: " + $code) -ForegroundColor Yellow
    } catch {}
  }
  exit 1
}
