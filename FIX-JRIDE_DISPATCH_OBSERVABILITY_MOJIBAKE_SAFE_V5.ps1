$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

$root = Get-Location
$path = Join-Path $root 'app\dispatch\page.tsx'
if (!(Test-Path $path)) { Fail "Missing app\dispatch\page.tsx (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $(Split-Path $bak -Leaf)"

$txt = Get-Content -LiteralPath $path -Raw
$lines = $txt -split "`r?`n"

# Find non-ASCII occurrences (mojibake indicator)
$nonAsciiIdx = @()
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '[^\x00-\x7F]') { $nonAsciiIdx += $i }
}

if ($nonAsciiIdx.Count -eq 0) {
  Ok "[OK] No non-ASCII characters found in app\dispatch\page.tsx (already clean)."
  exit 0
}

# Try to scope to the Observability/Telemetry section (best effort, ASCII-only anchors)
$anchorPatterns = @(
  'Observability',
  'Telemetry',
  'debug',
  'trace',
  'timeline',
  'JRIDE_OBSERV',
  'driverState',
  'statusRaw',
  'derived',
  'from',
  'to'
)

$anchorLine = -1
for ($i=0; $i -lt $lines.Count; $i++) {
  foreach ($p in $anchorPatterns) {
    if ($lines[$i] -match $p) { $anchorLine = $i; break }
  }
  if ($anchorLine -ge 0) { break }
}

# Decide patch window:
# - If we found an anchor, patch 250 lines around it (scoped).
# - Else patch only around the first non-ASCII line.
$start = 0
$end = $lines.Count - 1

if ($anchorLine -ge 0) {
  $start = [Math]::Max(0, $anchorLine - 60)
  $end   = [Math]::Min($lines.Count - 1, $anchorLine + 250)
  Info "[INFO] Using scoped window around anchor line $($anchorLine + 1)."
} else {
  $firstBad = $nonAsciiIdx[0]
  $start = [Math]::Max(0, $firstBad - 40)
  $end   = [Math]::Min($lines.Count - 1, $firstBad + 80)
  Warn "[WARN] No anchor found; using window around first non-ASCII at line $($firstBad + 1)."
}

# Patch only within window: replace non-ASCII runs with ASCII arrow
for ($i=$start; $i -le $end; $i++) {
  if ($lines[$i] -match '[^\x00-\x7F]') {
    $lines[$i] = [regex]::Replace($lines[$i], '[^\x00-\x7F]+', ' -> ')
    $lines[$i] = [regex]::Replace($lines[$i], '\s*->\s*', ' -> ')
    $lines[$i] = [regex]::Replace($lines[$i], '\s{2,}', ' ')
  }
}

# Re-check: ensure we reduced non-ascii (at least in window)
$afterWindowBad = 0
for ($i=$start; $i -le $end; $i++) {
  if ($lines[$i] -match '[^\x00-\x7F]') { $afterWindowBad++ }
}
if ($afterWindowBad -gt 0) {
  Warn "[WARN] Some non-ASCII still remains in the patch window ($afterWindowBad line(s)). This may be legitimate Unicode, or another mojibake form."
}

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
$out = ($lines -join "`r`n")
[System.IO.File]::WriteAllText($path, $out, $utf8)

Ok "[OK] Patched dispatch/page.tsx: non-ASCII mojibake replaced with ASCII ' -> ' within scoped window."
Info "NEXT: npm run build"
