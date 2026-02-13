# PATCH-JRIDE_PHASE9B1_OPTIMISTIC_NUDGE_COOLDOWN.ps1
# UI-only: start cooldown immediately on Nudge click (even if API fails).
# ASCII only. PowerShell 5 compatible.

$ErrorActionPreference = "Stop"
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Fail($m){ throw $m }

$path = Join-Path (Get-Location) "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $path -Raw

# Anchor: inside Nudge onClick we currently do setLastAction("Nudging...") before call
$needle = '                                    setLastAction("Nudging...");'
$idx = $txt.IndexOf($needle)
if ($idx -lt 0) { Fail "Anchor not found: setLastAction(""Nudging..."") inside Nudge handler." }

$replacement = @'
                                    const k = tripKey(t);
                                    if (k) setNudgedAt((prev) => ({ ...prev, [k]: Date.now() }));
                                    setLastAction("Nudging...");
'@

# Replace first occurrence only
$txt = [regex]::Replace($txt, [regex]::Escape($needle), $replacement, 1)
Ok "Inserted optimistic setNudgedAt before Nudge API call."

# Remove the old post-success setNudgedAt line (now redundant)
$oldLine = '                                    setNudgedAt((prev) => ({ ...prev, [tripKey(t)]: Date.now() }));'
if ($txt -notmatch [regex]::Escape($oldLine)) {
  Ok "Post-success setNudgedAt line not found (already removed)."
} else {
  $txt = [regex]::Replace($txt, [regex]::Escape($oldLine), '                                    // Phase 9B.1: nudgedAt set optimistically on click', 1)
  Ok "Replaced redundant post-success setNudgedAt line."
}

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $path"
Ok "Done."
