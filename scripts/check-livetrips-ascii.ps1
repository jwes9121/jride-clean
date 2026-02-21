param(
  [Parameter(Mandatory=$false)]
  [string]$ProjRoot = "."
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$ltDir = Join-Path $proj "app\admin\livetrips"
if (!(Test-Path -LiteralPath $ltDir)) {
  Write-Host "[FAIL] LiveTrips folder not found: $ltDir" -ForegroundColor Red
  exit 2
}

$files = Get-ChildItem -LiteralPath $ltDir -Recurse -File -Include *.ts,*.tsx

# Always keep hits as an array
$hits = @()

foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)

  $hasNonAscii = $false
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -ge 0x80) { $hasNonAscii = $true; break }
  }

  if ($hasNonAscii) { $hits += $f.FullName }
}

$hits = @($hits | Sort-Object -Unique)

if ($hits.Length -gt 0) {
  Write-Host "[FAIL] Non-ASCII bytes detected in LiveTrips source. Fix before commit/build:" -ForegroundColor Red
  $hits | ForEach-Object { Write-Host (" - " + $_) -ForegroundColor Yellow }
  exit 1
}

Write-Host "[OK] LiveTrips encoding guard passed (ASCII-only)." -ForegroundColor Green
exit 0