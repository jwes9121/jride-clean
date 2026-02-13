# PATCH-DISPATCH-FIX-DRIVERS-TDZ.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw

# Find the drivers state declaration
$idxDriversState = $txt.IndexOf("const [drivers, setDrivers]", [StringComparison]::Ordinal)
if ($idxDriversState -lt 0) { Fail "Could not find 'const [drivers, setDrivers]' in page.tsx" }

# Find the suggested-driver useEffect block that depends on [rows, drivers]
# We anchor on the unique call: setSuggestedDriverByBookingId(next);
$rxEffect = '(?ms)React\.useEffect\(\(\)\s*=>\s*\{[\s\S]*?setSuggestedDriverByBookingId\(\s*next\s*\)\s*;[\s\S]*?\}\s*,\s*\[\s*rows\s*,\s*drivers\s*\]\s*\)\s*;\s*'
$m = [regex]::Match($txt, $rxEffect)
if (!$m.Success) {
  Fail "Could not locate the suggested-driver useEffect block (React.useEffect ... [rows, drivers])."
}

$effectStart = $m.Index
$effectLen   = $m.Length

# If effect already after drivers state, nothing to do
if ($effectStart -gt $idxDriversState) {
  Write-Host "[OK] Suggested-driver effect is already after drivers state. No reorder needed." -ForegroundColor Green
  exit 0
}

$effectBlock = $m.Value

# Remove the effect from its current position
$txtRemoved = $txt.Remove($effectStart, $effectLen)

# Recompute drivers state index in the removed text
$idxDriversState2 = $txtRemoved.IndexOf("const [drivers, setDrivers]", [StringComparison]::Ordinal)
if ($idxDriversState2 -lt 0) { Fail "After removal, could not re-find drivers state (unexpected)." }

# Insert the effect AFTER the per-row state block.
# Anchor: after the last of these states if present, else after drivers state line.
$anchors = @(
  "const [manualDriverByBookingId, setManualDriverByBookingId]",
  "const [suggestedDriverByBookingId, setSuggestedDriverByBookingId]",
  "const [selectedDriverByBookingId, setSelectedDriverByBookingId]",
  "const [driversError, setDriversError]",
  "const [drivers, setDrivers]"
)

$insertPos = -1
foreach ($a in $anchors) {
  $i = $txtRemoved.IndexOf($a, [StringComparison]::Ordinal)
  if ($i -ge 0) { $insertPos = [Math]::Max($insertPos, $i) }
}
if ($insertPos -lt 0) { Fail "Could not find any state anchors to insert after." }

# Move to end of that line (after semicolon)
$lineEnd = $txtRemoved.IndexOf(";", $insertPos)
if ($lineEnd -lt 0) { Fail "Could not find semicolon after state anchor line." }
$lineEnd = $lineEnd + 1

# Add a newline if needed
$insertText = "`r`n`r`n" + $effectBlock + "`r`n"

$txtFixed = $txtRemoved.Insert($lineEnd, $insertText)

# Also fix a common artifact: "]);async function" -> ensure newline between
$txtFixed = $txtFixed -replace '\]\);\s*async function', "]);`r`n`r`nasync function"

Set-Content -Path $file -Value $txtFixed -Encoding UTF8
Write-Host "[OK] Reordered suggested-driver effect to after drivers state (fixes TDZ crash)." -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Open /dispatch (the runtime error should be gone)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback (if needed):" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
