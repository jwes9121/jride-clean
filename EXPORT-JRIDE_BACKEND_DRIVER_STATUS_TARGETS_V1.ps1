Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
Set-Location $root

$targets = @(
  "app\api\dispatch\status\route.ts",
  "app\api\driver\active-trip\route.ts",
  "app\api\admin\livetrips\update-status\route.ts",
  "app\api\admin\update-trip-status\route.ts",
  "app\api\admin\livetrips\dispatch-actions\route.ts"
) | Where-Object { Test-Path $_ }

$out = Join-Path $root ("JRIDE_BACKEND_DRIVER_STATUS_TARGETS_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".zip")
if (Test-Path $out) { Remove-Item $out -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem

$tmp = Join-Path $env:TEMP ("jride_backend_targets_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

foreach ($t in $targets) {
  $dest = Join-Path $tmp $t
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Copy-Item -LiteralPath (Join-Path $root $t) -Destination $dest -Force
  Write-Host "[ADD] $t"
}

[System.IO.Compression.ZipFile]::CreateFromDirectory($tmp, $out)
Remove-Item $tmp -Recurse -Force

Write-Host "`n[OK] Created zip:" -ForegroundColor Green
Write-Host $out -ForegroundColor Green
