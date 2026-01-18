# FIND-JRIDE_WALLET_SERVICE_FILES_V1.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Get-Location).Path

Write-Host "[INFO] Searching under: $root" -ForegroundColor Cyan

$hits = Get-ChildItem -Recurse -File -Path $root |
  Where-Object {
    $p = $_.FullName.ToLowerInvariant()
    $n = $_.Name.ToLowerInvariant()
    ($p -match "\\supabase\\functions\\") -or
    ($p -match "\\functions\\") -or
    ($p -match "wallet-service") -or
    ($n -match "wallet")
  } |
  Select-Object FullName

if (-not $hits) {
  Write-Host "[WARN] No matches found." -ForegroundColor Yellow
  exit 0
}

Write-Host "[OK] Matches:" -ForegroundColor Green
$hits | ForEach-Object { Write-Host $_.FullName }
