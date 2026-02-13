# FIX-JRIDE_PHASE8D_CLEAN_ISACTIVE.ps1
# Fix: Remove literal `r`n artifacts and rewrite isActiveTripStatus cleanly

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function BackupFile($p){
  if(!(Test-Path $p)){ Fail "Missing file: $p" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak.$ts"
  Copy-Item $p $bak -Force
  Write-Host "[OK] Backup: $bak" -ForegroundColor Green
}
function LoadUtf8($p){
  $t = Get-Content -LiteralPath $p -Raw -Encoding UTF8
  if($t.Length -gt 0 -and [int]$t[0] -eq 0xFEFF){ $t = $t.Substring(1) }
  return $t
}
function SaveUtf8NoBom($p,$t){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $t, $utf8NoBom)
}

$client = "app\admin\livetrips\LiveTripsClient.tsx"
BackupFile $client

$txt = LoadUtf8 $client

# 1) Remove any literal `r`n sequences that may exist (cleanup)
$txt = $txt -replace '`\s*r`\s*n', "`r`n"

# 2) Replace the entire isActiveTripStatus function with a clean one
$pattern = '(?s)function\s+isActiveTripStatus\s*\(\s*s:\s*string\s*\)\s*\{[\s\S]*?\}'
$replacement = @'
function isActiveTripStatus(s: string) {
  return ["pending", "assigned", "on_the_way", "arrived", "enroute", "on_trip"].includes(s);
}
'@

$txt2 = [regex]::Replace($txt, $pattern, $replacement, 1)

if ($txt2 -eq $txt) {
  Fail "Could not locate function isActiveTripStatus(s: string) to replace."
}

SaveUtf8NoBom $client $txt2
Write-Host "[OK] Rewrote isActiveTripStatus cleanly." -ForegroundColor Green
