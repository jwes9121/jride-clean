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

$hits = @()
$files = Get-ChildItem -LiteralPath $ltDir -Recurse -File -Include *.ts,*.tsx

foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -ge 0x80) { $hits += $f.FullName; break }
  }
}

$hits = $hits | Sort-Object -Unique
if ($hits.Count -gt 0) {
  Write-Host "[FAIL] Non-ASCII bytes detected in LiveTrips source. Fix before commit/build:" -ForegroundColor Red
  $hits | ForEach-Object { Write-Host (" - " + $_) -ForegroundColor Yellow }
  exit 1
}

Write-Host "[OK] LiveTrips encoding guard passed (ASCII-only)." -ForegroundColor Green
exit 0