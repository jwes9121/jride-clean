# TEST-DRIVER-LOCATION-PING.ps1
# Sends a heartbeat ping to your local server (npm run dev must be running)

param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$DriverId = "PASTE_DRIVER_UUID_HERE",
  [double]$Lat = 16.829,
  [double]$Lng = 121.115,
  [string]$Status = "online",
  [string]$Town = "Lagawe",
  [string]$PingSecret = ""
)

$uri = "$BaseUrl/api/driver/location/ping"

$headers = @{ "Content-Type" = "application/json" }
if ($PingSecret) { $headers["x-jride-ping-secret"] = $PingSecret }

$body = @{
  driver_id = $DriverId
  lat = $Lat
  lng = $Lng
  status = $Status
  town = $Town
} | ConvertTo-Json

Write-Host "POST $uri"
Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body
