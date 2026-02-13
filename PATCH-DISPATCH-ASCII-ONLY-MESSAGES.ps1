# PATCH-DISPATCH-ASCII-ONLY-MESSAGES.ps1
# ASCII-only patch: replace any setFixMsg("Saved ...") with setFixMsg("Saved OK")
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }
function WriteUtf8NoBom([string]$path, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllBytes($path, $enc.GetBytes($text))
}

$ts = Stamp
$target = "app\dispatch\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

Copy-Item $target "$target.bak.$ts" -Force
Write-Host "[OK] Backup: $target.bak.$ts" -ForegroundColor Green

$txt = Get-Content $target -Raw

# Replace ANY: setFixMsg("Saved ...");
# with:        setFixMsg("Saved OK");
$rx = 'setFixMsg\("Saved[^"]*"\)'
$txt2 = [regex]::Replace($txt, $rx, 'setFixMsg("Saved OK")')

# Also replace any fancy arrows in UI messages if present (ASCII-safe)
$txt2 = $txt2.Replace("→","->")

if ($txt2 -eq $txt) {
  Write-Host "[WARN] No matching Saved message found to replace. File may already be ASCII." -ForegroundColor Yellow
} else {
  Write-Host "[OK] Replaced Saved message with ASCII 'Saved OK'." -ForegroundColor Green
}

WriteUtf8NoBom $target $txt2
Write-Host "[DONE] Patched: $target" -ForegroundColor Green
Write-Host "Next: npm.cmd run build ; git commit/tag/push ; redeploy" -ForegroundColor Yellow
