param(
  [Parameter(Mandatory=$true)] [string]$BaseUrl,
  [Parameter(Mandatory=$true)] [string]$DriverId,
  [Parameter(Mandatory=$true)] [double]$Lat,
  [Parameter(Mandatory=$true)] [double]$Lng,
  [string]$Town = "Lagawe",
  [string]$Status = "online"
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }

$BaseUrl = $BaseUrl.TrimEnd("/")
$url = "$BaseUrl/api/driver/location/ping"

Write-Host "== JRIDE DIAG: driver ping HTTP (V1 / PS5-safe / no redirects) =="

# Build JSON
$payload = @{
  driver_id = $DriverId
  lat = $Lat
  lng = $Lng
  status = $Status
  town = $Town
} | ConvertTo-Json -Depth 6 -Compress

# HttpClient without redirects
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(12)

$content = New-Object System.Net.Http.StringContent($payload, [System.Text.Encoding]::UTF8, "application/json")

Write-Host ("POST {0}" -f $url)
Write-Host ("BODY {0}" -f $payload)

try {
  $resp = $client.PostAsync($url, $content).GetAwaiter().GetResult()
} catch {
  Fail ("[FAIL] HTTP error: {0}" -f $_.Exception.Message)
}

$code = [int]$resp.StatusCode
$loc = $null
if ($resp.Headers.Location) { $loc = $resp.Headers.Location.ToString() }

$body = $null
try { $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult() } catch { $body = "" }

Write-Host ""
Write-Host ("HTTP {0}" -f $code)
if ($loc) { Write-Host ("Location: {0}" -f $loc) }
Write-Host ("Body: {0}" -f $body)

$client.Dispose()

Ok "[DONE] If you see 301/302/307/308 -> middleware redirect. If 401/403 -> auth/secret required."