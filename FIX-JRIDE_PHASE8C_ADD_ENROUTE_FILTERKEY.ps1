# FIX-JRIDE_PHASE8C_ADD_ENROUTE_FILTERKEY.ps1
# Hotfix v2: add "enroute" into FilterKey union (no \R; .NET regex safe)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Backup-File($path){
  if (!(Test-Path $path)) { Fail "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak" -ForegroundColor Green
}
function Write-FileUtf8NoBom($path, $text){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

$client = "app\admin\livetrips\LiveTripsClient.tsx"
Backup-File $client

$txt = Get-Content $client -Raw

# If already present, stop (no changes)
if ($txt -match '(?s)type\s+FilterKey\s*=.*?\|\s*"enroute"\b') {
  Write-Host "[OK] FilterKey already includes enroute. Nothing to change." -ForegroundColor Green
  exit 0
}

# Find the exact arrived line inside FilterKey and insert after it.
# This is intentionally simple + robust:
# Replace: | "arrived"\n
# With:    | "arrived"\n  | "enroute"\n
$pattern = '(?s)(type\s+FilterKey\s*=\s*(?:.|\r|\n)*?\|\s*"arrived"\s*(?:\r?\n))'
$replacement = ('$1  | "enroute"' + "`r`n")

$txt2 = $txt -replace $pattern, $replacement

if ($txt2 -eq $txt) {
  Fail "Could not locate FilterKey union containing an 'arrived' line. Paste the FilterKey block if this happens."
}

Write-FileUtf8NoBom $client $txt2
Write-Host "[OK] Inserted FilterKey: enroute" -ForegroundColor Green
