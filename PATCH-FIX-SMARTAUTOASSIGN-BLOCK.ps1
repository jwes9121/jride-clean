# PATCH-FIX-SMARTAUTOASSIGN-BLOCK.ps1
# Fixes malformed/duplicated <SmartAutoAssignSuggestions ...> JSX block in LiveTripsClient.tsx
# by removing the broken chunk and inserting ONE correct self-closing block.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

$root = (Get-Location).Path
$file = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $file)) { Fail "Missing file: $file" }

# Read as lines (preserve exact line structure)
$lines = Get-Content -Path $file -Encoding UTF8

# Find first occurrence of SmartAutoAssignSuggestions
$start = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '<SmartAutoAssignSuggestions\b') { $start = $i; break }
}
if ($start -lt 0) { Fail "Could not find <SmartAutoAssignSuggestions ...> in LiveTripsClient.tsx" }

# Capture indentation of the start line
$indent = ""
if ($lines[$start] -match '^(\s*)<SmartAutoAssignSuggestions\b') { $indent = $Matches[1] }

# Determine where to stop deleting:
# Prefer a real "/>" closure if present; otherwise stop before the next obvious JSX boundary.
$end = -1

# 1) Look for a self-closing terminator "/>" after start (within a reasonable window)
$maxLook = [Math]::Min($lines.Count - 1, $start + 120)
for ($j = $start; $j -le $maxLook; $j++) {
  if ($lines[$j] -match '\/>\s*$') { $end = $j; break }
}

# 2) If not found, stop before the next boundary tag/div close (works for broken blocks)
if ($end -lt 0) {
  for ($j = $start + 1; $j -le $maxLook; $j++) {
    $t = $lines[$j].Trim()
    if ($t -match '^</div>$' -or
        $t -match '^<div\b' -or
        $t -match '^<LiveTripsMap\b' -or
        $t -match '^</section>$' -or
        $t -match '^</main>$' -or
        $t -match '^</>$') {
      $end = $j - 1
      break
    }
  }
}

# 3) If still not found, fail loudly (we don't want to destroy unknown sections)
if ($end -lt 0 -or $end -lt $start) {
  Fail "Could not safely determine end of SmartAutoAssignSuggestions block. Paste lines around the block and I will target it exactly."
}

# Build the clean block with the same indentation
$block = @(
"${indent}<SmartAutoAssignSuggestions",
"${indent}  trip={selectedTrip as any}",
"${indent}  drivers={drivers as any}",
"${indent}  zoneStats={zoneStats as any}",
"${indent}  onAssign={(driverId: string) => {",
"${indent}    const bc =",
"${indent}      (selectedTrip as any)?.booking_code ||",
"${indent}      (selectedTrip as any)?.bookingCode;",
"${indent}    if (!bc) return;",
"${indent}    return assignDriver(String(bc), String(driverId));",
"${indent}  }}",
"${indent}/>"
)

# Replace the region
$newLines = @()
if ($start -gt 0) { $newLines += $lines[0..($start-1)] }
$newLines += $block
if ($end -lt ($lines.Count - 1)) { $newLines += $lines[($end+1)..($lines.Count-1)] }

# Write UTF8 (no BOM) to avoid mojibake issues
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($file, $newLines, $utf8NoBom)

Write-Host "OK: Rebuilt SmartAutoAssignSuggestions block in LiveTripsClient.tsx" -ForegroundColor Green
Write-Host "Sanity check (showing surrounding lines):" -ForegroundColor Cyan

# Print a small window around the inserted block
$previewStart = [Math]::Max(0, $start - 5)
$previewEnd   = [Math]::Min($newLines.Count - 1, $start + 20)
for ($k = $previewStart; $k -le $previewEnd; $k++) {
  "{0,4}: {1}" -f ($k+1), $newLines[$k] | Write-Host
}

Write-Host ""
Write-Host "Next: run -> npm run build" -ForegroundColor Yellow
