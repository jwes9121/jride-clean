# PATCH-JRIDE_PHASE11G_NOHOOK_ROBUST.ps1
# Phase 11G (NO HOOKS) for app/ride/page.tsx:
# - Auto-close verify panel when refreshCanBook receives a verified status
# - Works regardless of variable name used in setCanInfo(...)
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$target = "app\ride\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$lines = Get-Content $target

# Locate refreshCanBook start
$start = -1
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match "async\s+function\s+refreshCanBook\s*\(") { $start = $i; break }
}
if ($start -lt 0) { Fail "Could not find async function refreshCanBook(...)" }

# Search within next N lines for first setCanInfo(...)
$maxScan = 260
$setIdx = -1
$varName = $null

for ($j=$start; $j -lt [Math]::Min($lines.Count, $start + $maxScan); $j++) {
  $m = [regex]::Match($lines[$j], 'setCanInfo\s*\(\s*([A-Za-z_\$][A-Za-z0-9_\$]*)(?:\s+as\s+any)?\s*\)\s*;')
  if ($m.Success) {
    $setIdx = $j
    $varName = $m.Groups[1].Value
    break
  }
}

if ($setIdx -lt 0 -or -not $varName) {
  Fail "Could not locate a setCanInfo(<var>); line within refreshCanBook()."
}

# Check if already patched
$already = $false
for ($k=$setIdx; $k -lt [Math]::Min($lines.Count, $setIdx + 8); $k++) {
  if ($lines[$k] -match "setShowVerifyPanel\(false\)" -and $lines[$k] -match "verification_status") { $already = $true; break }
}

if (-not $already) {
  $inject = "    if (String(($varName as any)?.verification_status || `"```").toLowerCase() === `"verified`" || ($varName as any)?.verified === true) { setShowVerifyPanel(false); }"
  # Insert right after setCanInfo line
  $new = New-Object System.Collections.Generic.List[string]
  for ($i=0; $i -lt $lines.Count; $i++) {
    $new.Add($lines[$i])
    if ($i -eq $setIdx) { $new.Add($inject) }
  }
  $lines = $new.ToArray()
  Ok ("Inserted auto-close after setCanInfo(" + $varName + "); at line " + ($setIdx+1))
} else {
  Info "Auto-close already present near setCanInfo; skipping insert."
}

# Guard any setShowVerifyPanel(true) calls (safe, no hooks)
# Only guard if raw call exists.
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match "setShowVerifyPanel\(\s*true\s*\)\s*;") {
    $lines[$i] = $lines[$i] -replace "setShowVerifyPanel\(\s*true\s*\)\s*;", "if (!(String((canInfo as any)?.verification_status || `"```").toLowerCase() === `"verified`" || verified === true)) { setShowVerifyPanel(true); }"
  }
}

# Write back
[System.IO.File]::WriteAllLines($target, $lines, [System.Text.Encoding]::UTF8)
Ok "Patched: $target"
Info "Run npm build next."
