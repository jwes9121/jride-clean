# FIX-JRIDE_PHASE11D3_REMOVE_DUP_DEBUG_FLAG.ps1
# Removes duplicate "debug: debugBypass," lines inside object literals in app\ride\page.tsx.
# Keeps the first occurrence and deletes later duplicates.
# PowerShell 5 safe, ASCII only.

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

# We will keep the first exact line "debug: debugBypass," and remove any later identical lines.
$kept = $false
$out = New-Object System.Collections.Generic.List[string]

for ($i = 0; $i -lt $lines.Count; $i++) {
  $ln = $lines[$i]

  if ($ln -match '^\s*debug:\s*debugBypass,\s*$') {
    if (-not $kept) {
      $kept = $true
      $out.Add($ln) | Out-Null
    } else {
      # skip duplicates
    }
  } else {
    $out.Add($ln) | Out-Null
  }
}

if (-not $kept) { Fail "No 'debug: debugBypass,' line found to dedupe." }

Set-Content -LiteralPath $path -Value $out.ToArray() -Encoding UTF8
Ok "Removed duplicate debug flag lines (kept first)."
Ok "Done."
