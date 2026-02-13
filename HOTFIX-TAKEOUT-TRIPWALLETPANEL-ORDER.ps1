# C:\Users\jwes9\Desktop\jride-clean-fresh\HOTFIX-TAKEOUT-TRIPWALLETPANEL-ORDER.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $repo "app\admin\livetrips\components\TripWalletPanel.tsx"
if (!(Test-Path $file)) { Fail "Target not found: $file" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $file "$file.bak.$stamp" -Force
Write-Host "[OK] Backup created" -ForegroundColor Green

$txt = Get-Content $file -Raw

# Must contain these blocks (from our patches)
$lineIsTakeout = "const isTakeout = useMemo(() => isTakeoutTrip(trip), [trip]);"
if ($txt -notmatch [regex]::Escape($lineIsTakeout)) { Fail "Could not find isTakeout memo line to reorder." }

# Extract inserted blocks if present
# 1) fareDisplay block
$rxFareDisplay = [regex]'(?s)\r?\n\s*const\s+fareDisplay\s*=\s*useMemo\(\(\)\s*=>\s*\{.*?\}\s*,\s*\[.*?\]\s*\);\s*'
$fareDisplay = $null
$m1 = $rxFareDisplay.Match($txt)
if ($m1.Success) { $fareDisplay = $m1.Value; $txt = $rxFareDisplay.Replace($txt, "`r`n", 1) }

# 2) derivedFare + derivedCompanyCut block
$rxDerived = [regex]'(?s)\r?\n\s*//\s*TAKEOUT display-only estimate.*?\r?\n\s*const\s+derivedCompanyCut\s*=\s*useMemo\(\(\)\s*=>\s*\{.*?\}\s*,\s*\[.*?\]\s*\);\s*'
$derived = $null
$m2 = $rxDerived.Match($txt)
if ($m2.Success) { $derived = $m2.Value; $txt = $rxDerived.Replace($txt, "`r`n", 1) }

# Remove the isTakeout line from its current position
$txt = $txt.Replace($lineIsTakeout, "")

# Re-insert in correct order right after the fare memo line
$fareLine = "const fare = useMemo(() => computeFareFromBooking(trip), [trip]);"
if ($txt -notmatch [regex]::Escape($fareLine)) { Fail "Could not find fare memo line to anchor insert." }

$insert = "`r`n  " + $lineIsTakeout
if ($derived) { $insert = $insert + $derived }
if ($fareDisplay) { $insert = $insert + $fareDisplay }

$txt = $txt.Replace($fareLine, $fareLine + $insert)

# Final sanity: ensure isTakeout appears before fareDisplay reference block
$posIs = $txt.IndexOf($lineIsTakeout)
if ($posIs -lt 0) { Fail "Sanity failed: isTakeout not present after reinsert." }

# Quick “cannot access before initialization” guard: fareDisplay should be after isTakeout
if ($fareDisplay) {
  $posFD = $txt.IndexOf("const fareDisplay")
  if ($posFD -ge 0 -and $posFD -lt $posIs) { Fail "Sanity failed: fareDisplay still appears before isTakeout." }
}

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[DONE] Reordered: isTakeout now declared before derivedFare/fareDisplay." -ForegroundColor Green
Write-Host "Patched: $file" -ForegroundColor Green
