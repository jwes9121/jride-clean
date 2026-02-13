$ErrorActionPreference = "Stop"

# Find the first listening port among 3000..3010
$port = $null
for ($p=3000; $p -le 3010; $p++) {
  $c = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" } | Select-Object -First 1
  if ($c) { $port = $p; break }
}
if (-not $port) { throw "No dev server detected on ports 3000..3010. Start with: npm run dev" }

$url = "http://127.0.0.1:$port/api/admin/livetrips/page-data?debug=1"
$outJson = Join-Path (Get-Location) "tmp_page_data_debug.json"

Write-Host "[1/3] Using: $url" -ForegroundColor Cyan
$data = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 30

Write-Host "[2/3] Saving JSON to: $outJson" -ForegroundColor Cyan
($data | ConvertTo-Json -Depth 40) | Set-Content -Encoding UTF8 $outJson

# ASCII-only mojibake markers
$rx = [regex]'(?|?|?)'

function Scan($obj, [string]$path, $context) {
  if ($null -eq $obj) { return }

  if ($obj -is [string]) {
    if ($rx.IsMatch($obj)) {
      $ctx = ""
      if ($context -and $context.booking_code) { $ctx = " booking_code=" + $context.booking_code }
      elseif ($context -and $context.id) { $ctx = " id=" + $context.id }
      Write-Host ("[MOJIBAKE]" + $ctx + " " + $path + " = " + $obj) -ForegroundColor Yellow
    }
    return
  }

  if ($obj -is [System.Collections.IDictionary]) {
    $newCtx = $context
    if ($obj.Contains("booking_code") -or $obj.Contains("id")) { $newCtx = $obj }
    foreach ($k in $obj.Keys) { Scan $obj[$k] ($path + "." + $k) $newCtx }
    return
  }

  if ($obj -is [System.Collections.IEnumerable]) {
    $i = 0
    foreach ($item in $obj) { Scan $item ($path + "[" + $i + "]") $context; $i++ }
    return
  }
}

Write-Host "[3/3] Scanning for mojibake strings..." -ForegroundColor Cyan
Scan $data "`$" $null

Write-Host ""
Write-Host "Done." -ForegroundColor Green
