param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$Path) {
  if (!(Test-Path $Path)) { throw "Missing file: $Path" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function Backup-File([string]$Path, [string]$Tag) {
  $Dir = Split-Path -Parent $Path
  $BakDir = Join-Path $Dir "_patch_bak"
  if (!(Test-Path $BakDir)) {
    New-Item -ItemType Directory -Path $BakDir -Force | Out-Null
  }
  $Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $Name = Split-Path $Path -Leaf
  $Bak = Join-Path $BakDir "$Name.bak.$Tag.$Stamp"
  Copy-Item $Path $Bak -Force
  return $Bak
}

Write-Host "== FIX JRIDE FARE ACCEPT EXCEPTION TYPE V1 (PS5-safe) =="

$target = Join-Path $WebRoot "app\api\public\passenger\fare\accept\route.ts"
if (!(Test-Path $target)) {
  throw "Target file not found: $target"
}

$bak = Backup-File -Path $target -Tag "FARE_ACCEPT_EXCEPTION_TYPE_V1"
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$text = Read-Text $target
$original = $text

$text = $text.Replace('catch (_: Exception) {}', 'catch (_: any) {}')

if ($text -eq $original) {
  throw "Target text not found. No changes made."
}

Write-Utf8NoBom -Path $target -Content $text
Write-Host "[OK] Wrote: $target" -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run build"
Write-Host "2) Commit and push if build passes"