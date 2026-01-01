# CLEAN-JRIDE_REMOVE_RIDE_DEBUG_BYPASS.ps1
# Removes debugBypass logic + debug flags from app\ride\page.tsx.
# Keeps Phase 11A live polling intact.
# ASCII only. PowerShell 5 compatible.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$path = Join-Path (Get-Location) "app\ride\page.tsx"
if (-not (Test-Path $path)) { Fail "Not found: $path" }
Info "Target: $path"

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$lines = Get-Content -LiteralPath $path -Encoding UTF8

$out = New-Object System.Collections.Generic.List[string]

$skip = $false
$skipDepth = 0

for ($i=0; $i -lt $lines.Count; $i++) {
  $ln = $lines[$i]

  # Remove any single-line debug flag in payload
  if ($ln -match '^\s*debug:\s*debugBypass,\s*$') { continue }

  # Remove any debug bypass result line
  if ($ln -match 'DEBUG_BYPASS') { continue }

  # Start skipping the debugBypass memo block
  if (-not $skip -and $ln -match 'const\s+debugBypass\s*=\s*React\.useMemo') {
    $skip = $true
    $skipDepth = 0
    continue
  }

  if ($skip) {
    # Track braces until the memo block ends "}, []);"
    if ($ln -match '\{') { $skipDepth++ }
    if ($ln -match '\}') {
      if ($skipDepth -gt 0) { $skipDepth-- }
    }
    if ($ln -match '\},\s*\[\s*\]\s*\)\s*;') {
      $skip = $false
      continue
    }
    continue
  }

  # Remove any injected bypass guard that references debugBypass
  if ($ln -match 'debugBypass') {
    # If it’s part of a comment or injected guard, drop it.
    if ($ln -match 'Debug bypass' -or $ln -match 'NIGHT_GATE_UNVERIFIED' -or $ln -match 'BOOKING_POLL' -or $ln -match 'ignore') {
      continue
    }
  }

  $out.Add($ln) | Out-Null
}

Set-Content -LiteralPath $path -Value $out.ToArray() -Encoding UTF8
Ok "Removed ride-page debug bypass + debug flags."
Ok "Done."
