$scriptPath = ".\PATCH-JRIDE_ANDROID_DRIVER_UI_WALKIN_TAKEOVER_V1.ps1"
@'
# PATCH-JRIDE_ANDROID_DRIVER_UI_WALKIN_TAKEOVER_V1.ps1
$ErrorActionPreference = "Stop"
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$root = (Get-Location).Path
$kt  = Join-Path $root "app\src\main\java\com\jride\app\MainActivity.kt"
$xml = Join-Path $root "app\src\main\res\layout\activity_main.xml"

if (!(Test-Path $kt))  { Fail "Missing: $kt" }
if (!(Test-Path $xml)) { Fail "Missing: $xml" }

$ts = Stamp
Copy-Item $kt  "$kt.bak.$ts" -Force
Copy-Item $xml "$xml.bak.$ts" -Force
Write-Host "[OK] Backup: $kt.bak.$ts"
Write-Host "[OK] Backup: $xml.bak.$ts"

$MainActivity = @'
REPLACE_ME_MAINACTIVITY
'@

$ActivityXml = @'
REPLACE_ME_ACTIVITYXML
'@

Set-Content -LiteralPath $kt  -Value $MainActivity -Encoding UTF8
Set-Content -LiteralPath $xml -Value $ActivityXml  -Encoding UTF8

Write-Host "[DONE] Patched Android UI + Walk-in + Change device:"
Write-Host " - $kt"
Write-Host " - $xml"
'@ | Set-Content -LiteralPath $scriptPath -Encoding UTF8

Write-Host "[OK] Created: $scriptPath"
