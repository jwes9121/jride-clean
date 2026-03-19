# PATCH-JRIDE_LIVETRIPSCLIENT_STRICT_TRIPS_SOURCE_V3_PS5SAFE.ps1
param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }

function Find-MatchingBraceEnd {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][int]$OpenBraceIndex
  )

  $depth = 0
  for ($i = $OpenBraceIndex; $i -lt $Text.Length; $i++) {
    $ch = $Text[$i]
    if ($ch -eq '{') { $depth++ }
    elseif ($ch -eq '}') {
      $depth--
      if ($depth -eq 0) { return $i }
    }
  }
  return -1
}

function Get-FunctionBlock {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$SignatureRegex
  )

  $m = [regex]::Match($Text, $SignatureRegex, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $m.Success) {
    Fail "Could not locate function signature pattern: $SignatureRegex"
  }

  $sigStart = $m.Index
  $braceIndex = $Text.IndexOf('{', $sigStart)
  if ($braceIndex -lt 0) {
    Fail "Could not locate opening brace after function signature."
  }

  $endIndex = Find-MatchingBraceEnd -Text $Text -OpenBraceIndex $braceIndex
  if ($endIndex -lt 0) {
    Fail "Could not locate matching closing brace for target function."
  }

  return [pscustomobject]@{
    Start = $sigStart
    End   = $endIndex
    Block = $Text.Substring($sigStart, ($endIndex - $sigStart + 1))
  }
}

function Replace-FunctionBySignature {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$SignatureRegex,
    [Parameter(Mandatory = $true)][string]$Replacement
  )

  $fn = Get-FunctionBlock -Text $Text -SignatureRegex $SignatureRegex
  $before = $Text.Substring(0, $fn.Start)
  $after  = $Text.Substring($fn.End + 1)
  return ($before + $Replacement + $after)
}

if (-not (Test-Path -LiteralPath $WebRoot)) {
  Fail "WebRoot not found: $WebRoot"
}

$target = Join-Path $WebRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $target)) {
  Fail "LiveTripsClient.tsx not found: $target"
}

$raw = Get-Content -LiteralPath $target -Raw
if ([string]::IsNullOrWhiteSpace($raw)) {
  Fail "LiveTripsClient.tsx is empty"
}

$signature = 'function parseTripsFromPageData\(j:\s*any\):\s*TripRow\[\]\s*'

$backupDir = Join-Path $WebRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("LiveTripsClient.tsx.bak.STRICT_TRIPS_SOURCE_V3." + $stamp)
Copy-Item -LiteralPath $target -Destination $backup -Force
Ok "Backup: $backup"

$replacement = @'
function parseTripsFromPageData(j: any): TripRow[] {
  // LIVETRIPS_STRICT_TRIPS_SOURCE_V3
  // Only accept the canonical trips array from page-data.
  if (!j) return [];
  if (!Array.isArray(j.trips)) return [];
  return safeArray<TripRow>(j.trips);
}
'@

$patched = Replace-FunctionBySignature -Text $raw -SignatureRegex $signature -Replacement $replacement

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $patched, $utf8NoBom)
Ok "Patched: $target"

$verifyRaw = Get-Content -LiteralPath $target -Raw
$fn = Get-FunctionBlock -Text $verifyRaw -SignatureRegex $signature
$block = $fn.Block

$required = @(
  'LIVETRIPS_STRICT_TRIPS_SOURCE_V3',
  'if (!Array.isArray(j.trips)) return [];',
  'return safeArray<TripRow>(j.trips);'
)

$forbidden = @(
  'j.bookings',
  'j.data',
  'j["0"]',
  'Array.isArray(j) ? j : null'
)

$missing = @()
foreach ($m in $required) {
  if ($block.IndexOf($m) -lt 0) { $missing += "missing in function: $m" }
}
foreach ($m in $forbidden) {
  if ($block.IndexOf($m) -ge 0) { $missing += "forbidden still in function: $m" }
}

if ($missing.Count -gt 0) {
  Fail ("Verification failed:`n - " + ($missing -join "`n - "))
}

Ok "Verification passed."

Write-Host ""
Info "Current parseTripsFromPageData()"
Write-Host $block
Write-Host ""
Info "Now run: npm run build"