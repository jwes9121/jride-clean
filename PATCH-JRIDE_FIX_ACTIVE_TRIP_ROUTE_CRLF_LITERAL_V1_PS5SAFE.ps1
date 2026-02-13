# PATCH-JRIDE_FIX_ACTIVE_TRIP_ROUTE_CRLF_LITERAL_V1_PS5SAFE.ps1
# Fix: literal "`r`n" text accidentally inserted into TS file causing syntax error.
# PS5-safe, backups included.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$projRoot = (Get-Location).Path
$target   = Join-Path $projRoot "app\api\driver\active-trip\route.ts"

Info "== JRide Patch: Fix literal `r`n in active-trip route (V1 / PS5-safe) =="
Info ("Project: " + $projRoot)

if (!(Test-Path $target)) {
  throw "Target not found: $target"
}

$bakDir = Join-Path $projRoot "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.active-trip.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content -Raw -LiteralPath $target

# Count occurrences of the literal sequence: backtick r backtick n
$literal = '`r`n'
$matches = [regex]::Matches($txt, [regex]::Escape($literal)).Count

if ($matches -eq 0) {
  Warn "[WARN] No literal `r`n sequences found. Nothing to patch."
  exit 0
}

Info ("Found literal `r`n sequences: " + $matches)

# Replace with real CRLF
$fixed = $txt -replace [regex]::Escape($literal), "`r`n"

# Write back
Set-Content -LiteralPath $target -Value $fixed -Encoding UTF8
Ok "[OK] Patched: $target"

Info ""
Info "Next: run a clean build to confirm webpack passes."
