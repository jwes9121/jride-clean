$ErrorActionPreference = "Stop"

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$scanDir = Join-Path $root "app\admin\livetrips"
if (!(Test-Path $scanDir)) { throw "Folder not found: $scanDir" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $root ("backups\LIVETRIPS_STUCKTEXT_PATCH_FIXED_" + $stamp)
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

$needle = "Stuck watcher thresholds"

Write-Host "[1/3] Searching for stuck watcher threshold source..." -ForegroundColor Cyan
$hits = Get-ChildItem $scanDir -Recurse -Include *.ts,*.tsx -File |
  Select-String -SimpleMatch -Pattern $needle -ErrorAction SilentlyContinue

$files = $hits | Select-Object -ExpandProperty Path -Unique
if ($files.Count -eq 0) { throw "No matches found under $scanDir for: $needle" }

Write-Host ""
Write-Host "FOUND in these file(s):" -ForegroundColor Yellow
$files | ForEach-Object { Write-Host (" - " + $_) }

# Build problem characters by codepoint (ASCII-safe script)
$enDash = [char]0x2013
$emDash = [char]0x2014
$nbsp   = [char]0x00A0

# Mojibake sequences for UTF-8 bytes misread as Windows-1252:
# E2 80 93 => "???"  (U+00E2 U+20AC U+201C)
# E2 80 94 => "???"  (U+00E2 U+20AC U+201D)
$mojiEndash = [string]::Concat([char]0x00E2,[char]0x20AC,[char]0x201C)
$mojiEmdash = [string]::Concat([char]0x00E2,[char]0x20AC,[char]0x201D)

$utf8 = New-Object System.Text.UTF8Encoding($false)
$changed = 0

Write-Host ""
Write-Host "[2/3] Backing up and patching matched file(s)..." -ForegroundColor Cyan

foreach ($f in $files) {
  $rel = $f.Substring($root.Length).TrimStart("\")
  $dest = Join-Path $bakDir $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Copy-Item $f $dest -Force

  $txt  = Get-Content $f -Raw -Encoding UTF8
  $orig = $txt

  # Normalize known dash variants + NBSP
  $txt = $txt.Replace($mojiEndash, "-")
  $txt = $txt.Replace($mojiEmdash, "-")
  $txt = $txt.Replace([string]$enDash, "-")
  $txt = $txt.Replace([string]$emDash, "-")
  $txt = $txt.Replace([string]$nbsp, " ")

  # Last line of defense: replace ANY remaining non-ASCII with '-'
  $txt = [regex]::Replace($txt, "[^\x00-\x7F]", "-")

  if ($txt -ne $orig) {
    [System.IO.File]::WriteAllText($f, $txt, $utf8)
    $changed++
    Write-Host ("Patched: " + $rel) -ForegroundColor Green
  } else {
    Write-Host ("No change needed: " + $rel) -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host ("[OK] Patch complete. Files changed: " + $changed) -ForegroundColor Green
Write-Host ("[OK] Backups stored at: " + $bakDir) -ForegroundColor Green

Write-Host ""
Write-Host "[3/3] NEXT (run these):" -ForegroundColor Cyan
Write-Host "1) Ctrl+C (stop dev server)"
Write-Host "2) Remove-Item .next -Recurse -Force"
Write-Host "3) npm run dev"
Write-Host "4) Ctrl+Shift+R (hard refresh)"
