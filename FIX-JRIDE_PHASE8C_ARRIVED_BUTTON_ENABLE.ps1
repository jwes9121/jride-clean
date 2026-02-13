# FIX-JRIDE_PHASE8C_ARRIVED_BUTTON_ENABLE.ps1
# Fix: Arrived button should be enabled only when status === "on_the_way"

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

# Target ONLY the Arrived button in the row actions:
# It contains updateTripStatus(..., "arrived") and button label "Arrived"
$pattern = '(?s)(updateTripStatus\(t\.booking_code,\s*"arrived"\)[\s\S]*?)(disabled=\{[^\}]*\})([\s\S]*?>\s*Arrived\s*</button>)'
$replacement = '$1disabled={s !== "on_the_way"}$3'

$txt2 = $txt -replace $pattern, $replacement

if ($txt2 -eq $txt) {
  Fail "Could not locate the Arrived button block to patch. Paste the Arrived button section from LiveTripsClient.tsx."
}

Write-FileUtf8NoBom $client $txt2
Write-Host "[OK] Patched Arrived button enable rule (on_the_way -> arrived)." -ForegroundColor Green
