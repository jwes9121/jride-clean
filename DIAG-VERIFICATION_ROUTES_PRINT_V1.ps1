$ErrorActionPreference = "Stop"

$paths = @(
  ".\app\api\public\passenger\verification\request\route.ts",
  ".\app\api\admin\verification\pending\route.ts",
  ".\app\api\admin\verification\decide\route.ts",
  ".\app\admin\control-center\page.tsx"
)

foreach ($p in $paths) {
  Write-Host "`n===== $p =====" -ForegroundColor Cyan
  if (!(Test-Path $p)) {
    Write-Host "MISSING" -ForegroundColor Red
    continue
  }
  (Get-Content $p -Raw) | Select-Object -First 1 | Out-Null
  Get-Content $p -TotalCount 220
}
