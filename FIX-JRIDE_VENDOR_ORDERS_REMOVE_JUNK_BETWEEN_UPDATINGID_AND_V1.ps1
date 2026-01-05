# FIX-JRIDE_VENDOR_ORDERS_REMOVE_JUNK_BETWEEN_UPDATINGID_AND_V1.ps1
# Fix: remove corrupted junk lines between updatingId state and VENDOR_CORE_V1_REFINEMENTS marker
# File: app/vendor-orders/page.tsx
# One file only. No manual edits.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }

$rel = "app\vendor-orders\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$lines = Get-Content -LiteralPath $path -ErrorAction Stop

# Find updatingId line (exact-ish)
$idxA = -1
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*const\s*\[\s*updatingId\s*,\s*setUpdatingId\s*\]\s*=\s*useState<\s*string\s*\|\s*null\s*>\(\s*null\s*\);\s*$') {
    $idxA = $i
    break
  }
}
if ($idxA -lt 0) { Fail "Could not find updatingId state line." }

# Find V1 marker after it
$idxB = -1
for ($j=$idxA+1; $j -lt $lines.Count; $j++) {
  if ($lines[$j] -match '^\s*//\s*VENDOR_CORE_V1_REFINEMENTS\s*$') {
    $idxB = $j
    break
  }
}
if ($idxB -lt 0) { Fail "Could not find // VENDOR_CORE_V1_REFINEMENTS marker after updatingId line." }

if ($idxB -le $idxA+1) {
  Ok "No junk lines found between updatingId and V1 marker. No change."
  exit 0
}

# Build new file:
# keep everything up to updatingId line
# keep exactly one blank line
# keep everything from V1 marker onwards
$out = New-Object System.Collections.Generic.List[string]
for ($k=0; $k -le $idxA; $k++) { $out.Add($lines[$k]) }
$out.Add("") # one clean spacer line
for ($k=$idxB; $k -lt $lines.Count; $k++) { $out.Add($lines[$k]) }

# Write back
Set-Content -LiteralPath $path -Value $out -Encoding UTF8
Ok "Patched: $rel"
Ok "Removed junk lines between updatingId and VENDOR_CORE_V1_REFINEMENTS."
