# RESTORE-JRIDE_LIVETRIPSCLIENT_FROM_GIT_HEAD.ps1
# Purpose: End the syntax loop by restoring LiveTripsClient.tsx from Git HEAD (last committed GREEN state).
# HARD RULES: DO_NOT_TOUCH_DISPATCH_STATUS, NO_DECLARE, ASCII-only

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$fileRel = "app\admin\livetrips\LiveTripsClient.tsx"
$file = Join-Path $root $fileRel

if(!(Test-Path $file)){ Fail ("File not found: " + $file) }

# Backup current broken file (so you can recover any UI changes later if needed)
$bak = "$file.bak.RESTORE_FROM_GIT_HEAD.$(Stamp)"
Copy-Item -LiteralPath $file -Destination $bak -Force
Write-Host "[OK] Backup current file: $bak"

# Ensure we're inside a git repo
$inside = (git rev-parse --is-inside-work-tree 2>$null)
if($LASTEXITCODE -ne 0 -or ($inside -ne "true")){
  Fail "Not inside a git working tree. Run this from repo root."
}

# Restore file from HEAD
git restore --source=HEAD -- $fileRel 2>$null
if($LASTEXITCODE -ne 0){
  # Fallback for older git
  git checkout -- $fileRel
}
if($LASTEXITCODE -ne 0){
  Fail "Git restore/checkout failed."
}

Write-Host "[OK] Restored from Git HEAD: $file"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) powershell -ExecutionPolicy Bypass -File .\DIAG-JRIDE_LIVETRIPSCLIENT_BRACE_PAREN_BALANCE_SCANNER.ps1"
Write-Host "  2) npm.cmd run build"
