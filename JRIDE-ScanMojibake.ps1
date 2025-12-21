$ErrorActionPreference = "Stop"

$url = "http://localhost:3000/api/admin/livetrips/page-data?debug=1"
$outJson = Join-Path (Get-Location) "tmp_page_data_debug.json"

Write-Host "[1/3] Fetching page-data..." -ForegroundColor Cyan
$data = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 30

Write-Host "[2/3] Saving JSON to: $outJson" -ForegroundColor Cyan
($data | ConvertTo-Json -Depth 40) | Set-Content -Encoding UTF8 $outJson

# ASCII-only mojibake markers (no special chars in this regex)
# Most broken text will contain one of these sequences:
#   "?" or "?" or "?"  (all ASCII letters)
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
    foreach ($k in $obj.Keys) {
      Scan $obj[$k] ($path + "." + $k) $newCtx
    }
    return
  }

  if ($obj -is [System.Collections.IEnumerable]) {
    $i = 0
    foreach ($item in $obj) {
      Scan $item ($path + "[" + $i + "]") $context
      $i++
    }
    return
  }
}

Write-Host "[3/3] Scanning for mojibake strings..." -ForegroundColor Cyan
Scan $data "`$" $null

Write-Host ""
Write-Host "Done. Any [MOJIBAKE] lines above identify the exact JSON path + record." -ForegroundColor Green
