# PATCH-DISPATCH-REPLACE-ELLIPSIS-ASCII.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$glob = @(
  Join-Path $root "app\dispatch\**\*.tsx",
  Join-Path $root "app\dispatch\**\*.ts"
)

# Find files containing the ellipsis character …
$files = @()
foreach ($g in $glob) {
  $m = @(Select-String -Path $g -Pattern "…" -List -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path)
  $files += $m
}
$files = $files | Sort-Object -Unique

if ($files.Count -eq 0) {
  Fail "No ellipsis character found under app\dispatch. Nothing to patch."
}

Write-Host "[INFO] Files containing ellipsis (…):" -ForegroundColor Cyan
$files | ForEach-Object { Write-Host " - $_" }

# Patch each file: replace … with ...
foreach ($f in $files) {
  $ts = Get-Date -Format "yyyyMMdd-HHmmss"
  $bak = "$f.bak.$ts"
  Copy-Item $f $bak -Force

  $txt = Get-Content $f -Raw
  $txt2 = $txt.Replace("…", "...")

  if ($txt2 -ne $txt) {
    Set-Content -Path $f -Value $txt2 -Encoding UTF8
    Write-Host ("[OK] Patched: " + $f + " (backup: " + $bak + ")") -ForegroundColor Green
  } else {
    Write-Host ("[SKIP] No change: " + $f) -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Refresh /dispatch a few times; the Loading... text should no longer flash as mojibake." -ForegroundColor Cyan
