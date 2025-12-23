# PATCH-DISPATCH-REPLACE-ELLIPSIS-ASCII-v2.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$dir  = Join-Path $root "app\dispatch"
if (!(Test-Path $dir)) { Fail "Dispatch folder not found: $dir" }

# Find all .ts/.tsx under app\dispatch containing the ellipsis character …
$allFiles = Get-ChildItem -Path $dir -Recurse -File -Include *.ts, *.tsx
$targets = @()

foreach ($f in $allFiles) {
  $raw = Get-Content $f.FullName -Raw
  if ($raw -like "*…*") { $targets += $f.FullName }
}

$targets = $targets | Sort-Object -Unique
if ($targets.Count -eq 0) { Fail "No ellipsis character found under app\dispatch. Nothing to patch." }

Write-Host "[INFO] Files containing ellipsis (…):" -ForegroundColor Cyan
$targets | ForEach-Object { Write-Host (" - " + $_) }

foreach ($path in $targets) {
  $ts = Get-Date -Format "yyyyMMdd-HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force

  $txt = Get-Content $path -Raw
  $txt2 = $txt.Replace("…", "...")

  if ($txt2 -ne $txt) {
    Set-Content -Path $path -Value $txt2 -Encoding UTF8
    Write-Host ("[OK] Patched: " + $path + " (backup: " + $bak + ")") -ForegroundColor Green
  } else {
    Write-Host ("[SKIP] No change: " + $path) -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Refresh /dispatch a few times; Loading... should no longer flash as mojibake." -ForegroundColor Cyan
