# C:\Users\jwes9\Desktop\jride-clean-fresh\HOTFIX-TAKEOUT-UI-REPLACE-HELPER-BLOCK.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $repo "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $file)) { Fail "Target file not found: $file" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$stamp"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup created:`n  $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw

$marker = "// TAKEOUT row detection + display helpers"
$start = $txt.IndexOf($marker)
if ($start -lt 0) { Fail "Could not find helper block marker: $marker" }

# End the block right before 'const mins ='
$minsNeedle = "const mins ="
$end = $txt.IndexOf($minsNeedle, $start)
if ($end -lt 0) { Fail "Could not find end needle '$minsNeedle' after helper marker. The file formatting changed." }

# New helper block (renamed vars, no collisions)
$newBlock = @'
// TAKEOUT row detection + display helpers (table only; no backend changes)
const rowTripType = String((t as any).trip_type || (t as any).tripType || "").trim().toLowerCase();
const rowCodeUpper = String((t as any).booking_code || "").trim().toUpperCase();
const rowIsTakeout =
  rowTripType === "takeout" ||
  rowCodeUpper.startsWith("TAKEOUT-") ||
  rowCodeUpper.startsWith("TAKEOUT_") ||
  rowCodeUpper.startsWith("TAKEOUT");

const passengerDisplay =
  (t as any).passenger_name ||
  (rowIsTakeout ? ((t as any).vendor_name || "Takeout") : "-----");

const pickupDisplay =
  (t as any).pickup_label ||
  (t as any).from_label ||
  (rowIsTakeout ? "Vendor pickup" : "-----");

const dropoffDisplay =
  (t as any).dropoff_label ||
  (t as any).to_label ||
  (rowIsTakeout ? "Customer dropoff" : "-----");

'@

# Replace region [start, end)
$before = $txt.Substring(0, $start)
$after  = $txt.Substring($end)  # includes 'const mins =' onward
$txt2 = $before + $newBlock + $after

# Also normalize any accidental uppercase StartsWith across the file
$txt2 = [regex]::Replace($txt2, "\.StartsWith\s*\(", ".startsWith(")

Set-Content -Path $file -Value $txt2 -Encoding UTF8

# Sanity checks
$afterTxt = Get-Content $file -Raw

# Ensure helper block is now using rowTripType/rowIsTakeout
if ($afterTxt -notmatch "const rowTripType") { Fail "Sanity failed: rowTripType not found after patch." }
if ($afterTxt -notmatch "const rowIsTakeout") { Fail "Sanity failed: rowIsTakeout not found after patch." }

# Ensure the helper block area no longer declares const tripType (we only check between marker and const mins)
$start2 = $afterTxt.IndexOf($marker)
$end2 = $afterTxt.IndexOf($minsNeedle, $start2)
$segment = $afterTxt.Substring($start2, $end2 - $start2)

if ([regex]::IsMatch($segment, "(?-i)\bconst\s+tripType\b")) {
  Fail "Sanity failed: helper segment still declares 'const tripType' (should be rowTripType)."
}

Write-Host "[DONE] Helper block replaced (no duplicate tripType), StartsWith normalized." -ForegroundColor Green
Write-Host "Patched: $file" -ForegroundColor Green
