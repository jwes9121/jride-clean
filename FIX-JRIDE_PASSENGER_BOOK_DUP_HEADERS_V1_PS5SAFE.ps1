param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function New-Timestamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }
function Ensure-Dir([string]$p) { if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }
function Write-NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$ts = New-Timestamp

Write-Host "== JRIDE Fix: Remove duplicate headers in passenger book assign call (V1 / PS5-safe) =="

$target = Join-Path $proj "app\api\public\passenger\book\route.ts"
if (-not (Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

$bakDir = Join-Path $proj "_patch_bak"
Ensure-Dir $bakDir

$bak = Join-Path $bakDir ("route.ts.bak.PASSENGER_BOOK_DUP_HEADERS_FIX.$ts")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

# Remove the specific duplicate headers line that caused TS error
# (we only remove the lowercase content-type headers block)
$pattern = '^\s*headers\s*:\s*\{\s*"content-type"\s*:\s*"application\/json"\s*\}\s*,\s*$'
$lines = $txt -split "`r?`n"

$removed = 0
$newLines = foreach ($line in $lines) {
  if ($line -match $pattern) {
    $removed++
    continue
  }
  $line
}

if ($removed -eq 0) {
  Write-Warning "Did not find the exact duplicate headers line. No changes made."
} else {
  Write-Host "[OK] Removed $removed duplicate headers line(s)."
}

$txt2 = ($newLines -join "`n")
Write-NoBom $target $txt2

Write-Host "[OK] Wrote: $target"
Write-Host ""
Write-Host "[NEXT] Run: npm.cmd run build"