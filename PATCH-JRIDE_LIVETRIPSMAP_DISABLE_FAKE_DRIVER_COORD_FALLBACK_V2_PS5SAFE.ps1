# PATCH-JRIDE_LIVETRIPSMAP_DISABLE_FAKE_DRIVER_COORD_FALLBACK_V2_PS5SAFE.ps1
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

function Replace-FunctionBySignature {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$SignatureRegex,
    [Parameter(Mandatory = $true)][string]$Replacement
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

  $before = $Text.Substring(0, $sigStart)
  $after  = $Text.Substring($endIndex + 1)
  return ($before + $Replacement + $after)
}

if (-not (Test-Path -LiteralPath $WebRoot)) {
  Fail "WebRoot not found: $WebRoot"
}

$candidates = @(
  (Join-Path $WebRoot "app\admin\livetrips\components\LiveTripsMap.tsx"),
  (Join-Path $WebRoot "app\admin\livetrips\LiveTripsMap.tsx"),
  (Join-Path $WebRoot "app\admin\livetrips\components\map\LiveTripsMap.tsx")
)

$target = $null
foreach ($c in $candidates) {
  if (Test-Path -LiteralPath $c) {
    $target = $c
    break
  }
}

if (-not $target) {
  Fail "Could not find LiveTripsMap.tsx in expected locations."
}

$raw = Get-Content -LiteralPath $target -Raw
if ([string]::IsNullOrWhiteSpace($raw)) {
  Fail "Target map file is empty: $target"
}

if ($raw.IndexOf("DISABLE_DRIVER_COORD_FALLBACKS_V2") -ge 0) {
  Warn "Map file already appears patched. No changes applied."
  exit 0
}

$backupDir = Join-Path $WebRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("LiveTripsMap.tsx.bak.DISABLE_FAKE_DRIVER_COORD_FALLBACK_V2." + $stamp)
Copy-Item -LiteralPath $target -Destination $backup -Force
Ok "Backup: $backup"

$replacement = @'
function getDriverReal(trip: any): LngLatTuple | null {
  // DISABLE_DRIVER_COORD_FALLBACKS_V2
  // Only trust explicit driver_* coordinates.
  // Do not infer driver position from pickup/dropoff/other trip coordinates.
  const explicit = getExplicitDriver(trip);
  if (explicit) return explicit;
  return null;
}
'@

$patched = Replace-FunctionBySignature -Text $raw -SignatureRegex 'function getDriverReal\(trip:\s*any\):\s*LngLatTuple\s*\|\s*null\s*' -Replacement $replacement

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $patched, $utf8NoBom)
Ok "Patched: $target"

$verify = Get-Content -LiteralPath $target -Raw
$markers = @(
  'DISABLE_DRIVER_COORD_FALLBACKS_V2',
  'const explicit = getExplicitDriver(trip);',
  'return null;'
)

$missing = @()
foreach ($m in $markers) {
  if ($verify.IndexOf($m) -lt 0) { $missing += $m }
}

if ($missing.Count -gt 0) {
  Fail ("Verification failed. Missing markers: " + ($missing -join ", "))
}

Ok "Verification passed."
Info "Now run: npm run build"