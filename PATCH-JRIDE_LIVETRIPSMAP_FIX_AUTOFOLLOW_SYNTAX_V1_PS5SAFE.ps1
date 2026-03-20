# PATCH-JRIDE_LIVETRIPSMAP_FIX_AUTOFOLLOW_SYNTAX_V1_PS5SAFE.ps1
param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

$target = Join-Path $WebRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$raw = Get-Content -LiteralPath $target -Raw
if ([string]::IsNullOrWhiteSpace($raw)) {
  Fail "Target file is empty: $target"
}

$backupDir = Join-Path $WebRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("LiveTripsMap.tsx.bak.FIX_AUTOFOLLOW_SYNTAX_V1." + $stamp)
Copy-Item -LiteralPath $target -Destination $backup -Force
Ok "Backup: $backup"

$patterns = @(
  '}, \[selectedTripId, trips\]\);, \[selectedTripId, trips\]\);',
  '\}, \[selectedTripId, trips\]\);\s*,\s*\[selectedTripId, trips\]\);'
)

$fixed = $raw
foreach ($p in $patterns) {
  $fixed = [regex]::Replace($fixed, $p, '}, [selectedTripId, trips]);')
}

if ($fixed -eq $raw) {
  Warn "No exact duplicated dependency-array syntax pattern was found. Writing file unchanged."
} else {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($target, $fixed, $utf8NoBom)
  Ok "Patched: $target"
}

$verify = Get-Content -LiteralPath $target -Raw
if ($verify -match '\}, \[selectedTripId, trips\]\);\s*,\s*\[selectedTripId, trips\]\);') {
  Fail "Verification failed: duplicated dependency-array syntax still present."
}

Ok "Verification passed."
Write-Host "Now run: npm run build"