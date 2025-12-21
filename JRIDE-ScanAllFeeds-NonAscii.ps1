$ErrorActionPreference = "Stop"

# ---- detect dev server port (3000..3010) ----
$port = $null
for ($p=3000; $p -le 3010; $p++) {
  $c = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq "Listen" } | Select-Object -First 1
  if ($c) { $port = $p; break }
}
if (-not $port) { throw "No dev server detected on ports 3000..3010. Start with: npm run dev" }

$base = "http://127.0.0.1:$port"
$endpoints = @(
  "/api/admin/livetrips/page-data?debug=1",
  "/api/admin/driver_locations",
  "/api/admin/driver-locations"
)

# ASCII-only markers that often appear in mojibake (safe in PS scripts)
$markers = @("??", "??", "??", "??", "??")

function HasMarker([string]$s) {
  foreach ($m in $markers) { if ($s.Contains($m)) { return $true } }
  return $false
}

function HasNonAscii([string]$s) {
  foreach ($ch in $s.ToCharArray()) {
    if ([int][char]$ch -gt 127) { return $true }
  }
  return $false
}

function Scan($obj, [string]$path, $context) {
  if ($null -eq $obj) { return }

  if ($obj -is [string]) {
    $isM = HasMarker $obj
    $isN = HasNonAscii $obj
    if ($isM -or $isN) {
      $ctx = ""
      if ($context -and $context.booking_code) { $ctx = " booking_code=" + $context.booking_code }
      elseif ($context -and $context.id) { $ctx = " id=" + $context.id }

      $tag = if ($isM) { "[MOJIBAKE]" } else { "[NONASCII]" }
      Write-Host ($tag + $ctx + " " + $path + " = " + $obj) -ForegroundColor Yellow
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

foreach ($ep in $endpoints) {
  $url = $base + $ep
  Write-Host ""
  Write-Host ("=== Fetch: " + $url + " ===") -ForegroundColor Cyan

  try {
    $data = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 30
  } catch {
    Write-Host ("[FETCH FAILED] " + $_.Exception.Message) -ForegroundColor DarkYellow
    continue
  }

  Write-Host ("Scanning...") -ForegroundColor Cyan
  Scan $data "`$" $null
  Write-Host ("Done: " + $ep) -ForegroundColor Green
}
