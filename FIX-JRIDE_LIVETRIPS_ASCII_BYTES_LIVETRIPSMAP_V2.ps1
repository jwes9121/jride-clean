param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Info "== FIX JRIDE: ASCII BYTE clean LiveTripsMap.tsx (V2 / PS5-safe) =="

$root = (Resolve-Path -LiteralPath $RepoRoot).Path
$target = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"

Info ("RepoRoot: " + $root)
Info ("Target: " + $target)

if (-not (Test-Path -LiteralPath $target)) {
  throw "Target file not found: $target"
}

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force | Out-Null
Ok ("Backup created: " + $bak)

# Read raw bytes
[byte[]]$bytes = [System.IO.File]::ReadAllBytes($target)

# Detect UTF-8 BOM EF BB BF
$hasUtf8Bom = $false
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  $hasUtf8Bom = $true
  Warn "Detected UTF-8 BOM (EF BB BF) at start of file."
}

# Find non-ASCII bytes (> 0x7F)
$badIdx = New-Object System.Collections.Generic.List[int]
for ($i=0; $i -lt $bytes.Length; $i++) {
  if ($bytes[$i] -gt 0x7F) { $badIdx.Add($i) | Out-Null }
}

if ($badIdx.Count -eq 0 -and -not $hasUtf8Bom) {
  Ok "No non-ASCII bytes found and no BOM. Nothing to do."
  exit 0
}

Warn ("Non-ASCII bytes found: " + $badIdx.Count)
# Print first 20 bad byte positions
$sample = $badIdx | Select-Object -First 20
foreach ($idx in $sample) {
  $b = $bytes[$idx]
  Write-Host ("  offset {0}: 0x{1:X2}" -f $idx, $b) -ForegroundColor Yellow
}

# Strip UTF-8 BOM if present
if ($hasUtf8Bom) {
  $bytes = $bytes[3..($bytes.Length-1)]
}

# Now keep ONLY ASCII bytes + CR/LF/TAB
# (space and normal ASCII punctuation are included since <= 0x7F)
$out = New-Object System.Collections.Generic.List[byte]
foreach ($b in $bytes) {
  if ($b -le 0x7F) {
    $out.Add($b) | Out-Null
  } else {
    # drop
  }
}

# Ensure file ends with newline (optional but nice)
if ($out.Count -gt 0 -and $out[$out.Count-1] -ne 0x0A) {
  $out.Add(0x0D) | Out-Null
  $out.Add(0x0A) | Out-Null
}

# Write back bytes (pure ASCII, no BOM)
[System.IO.File]::WriteAllBytes($target, $out.ToArray())

Ok "Rewrote file as pure ASCII bytes (no BOM)."

# Final verify
[byte[]]$check = [System.IO.File]::ReadAllBytes($target)
for ($i=0; $i -lt $check.Length; $i++) {
  if ($check[$i] -gt 0x7F) {
    throw ("Verification failed: still found non-ASCII byte 0x{0:X2} at offset {1}" -f $check[$i], $i)
  }
}

Ok "Verification OK: no bytes > 0x7F remain."
Ok ("Patched: " + $target)