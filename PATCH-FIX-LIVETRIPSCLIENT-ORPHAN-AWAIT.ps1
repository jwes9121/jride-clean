# PATCH-FIX-LIVETRIPSCLIENT-ORPHAN-AWAIT.ps1
# Removes orphaned "Updating status..." block that contains await statements outside async scope.
# This fixes: Expected ';', got 'await' in LiveTripsClient.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$txt  = Get-Content -Raw -Encoding UTF8 $f
$orig = $txt

# Remove the orphan fragment starting at setLastAction("Updating status...") up through await loadPage();
# and any immediately-following closing braces/paren lines that typically close the broken wrapper.
$pattern = '(?s)\r?\n[ \t]*setLastAction\("Updating status\.\.\."\);\s*\r?\n[ \t]*optimisticStatus\([^\r\n;]*\);\s*\r?\n[ \t]*await\s+postJson\([^\r\n]*\r?\n(?:[^\r\n]*\r?\n){0,20}?[ \t]*await\s+loadPage\(\);\s*\r?\n(?:[ \t]*\}\s*;?\s*\r?\n)?(?:[ \t]*\)\s*;?\s*\r?\n)?'
$txt2 = [regex]::Replace($txt, $pattern, "`r`n", 1)

if ($txt2 -eq $txt) {
  # Fallback: remove any top-level "await updateTripStatus(...); await loadPage();" fragment
  $pattern2 = '(?s)\r?\n[ \t]*await\s+updateTripStatus\([^\r\n;]*\);\s*\r?\n[ \t]*await\s+loadPage\(\);\s*\r?\n'
  $txt2 = [regex]::Replace($txt, $pattern2, "`r`n", 1)
}

if ($txt2 -eq $txt) {
  Fail "Could not find the orphan await block to remove. Paste lines ~370-410 of LiveTripsClient.tsx and I'll target it exactly."
}

Set-Content -Path $f -Value $txt2 -Encoding UTF8
Write-Host "OK: Removed orphan await fragment from LiveTripsClient.tsx." -ForegroundColor Green

Write-Host "Next: clear .next and restart dev." -ForegroundColor Cyan
