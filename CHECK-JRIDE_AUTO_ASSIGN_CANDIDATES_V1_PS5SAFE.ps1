param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$Path) {
  if (!(Test-Path $Path)) { throw "Missing file: $Path" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Show-FileSection([string]$Title, [string]$Path) {
  Write-Host ""
  Write-Host ("=" * 110) -ForegroundColor DarkGray
  Write-Host $Title -ForegroundColor Cyan
  Write-Host ("=" * 110) -ForegroundColor DarkGray
  if (Test-Path $Path) {
    Write-Host "[FOUND] $Path" -ForegroundColor Green
    Write-Host ""
    Read-Text $Path
  } else {
    Write-Host "[MISSING] $Path" -ForegroundColor Yellow
  }
}

Write-Host "== CHECK JRIDE AUTO-ASSIGN CANDIDATES V1 (PS5-safe) =="

$files = @(
  (Join-Path $WebRoot "app\api\public\passenger\book\route.ts"),
  (Join-Path $WebRoot "app\api\dispatch\assign\route.ts"),
  (Join-Path $WebRoot "app\api\dispatch\auto-assign\route.ts"),
  (Join-Path $WebRoot "app\api\dispatch\retry-auto-assign\route.ts"),
  (Join-Path $WebRoot "app\api\rides\assign-nearest\route.ts"),
  (Join-Path $WebRoot "app\api\rides\assign-nearest\latest\route.ts"),
  (Join-Path $WebRoot "app\api\admin\auto-assign\route.ts"),
  (Join-Path $WebRoot "app\api\admin\livetrips\manual-assign\route.ts")
)

foreach ($f in $files) {
  Show-FileSection -Title ("FILE: " + $f) -Path $f
}