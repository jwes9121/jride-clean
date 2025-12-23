# PATCH-LIVETRIPS-WRAP-CODE-SPAN-FIXMOJIBAKE.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\admin\livetrips\components\TripLifecycleActions.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw

# Ensure helper exists (your previous run inserted it, but keep safe)
if ($txt -notmatch "function\s+fixMojibake\s*\(") {
  $helper = @'
function fixMojibake(v: any) {
  const s = String(v ?? "");
  if (!/[ÃÂ]/.test(s)) return s;
  try { return decodeURIComponent(escape(s)); } catch { return s; }
}

'@
  # insert after first blank line after imports
  $txt2 = [regex]::Replace($txt, '(?ms)^(.+?\r?\n\r?\n)', ('$1' + $helper), 1)
  if ($txt2 -eq $txt) { Fail "Failed to insert fixMojibake() helper." }
  $txt = $txt2
  Write-Host "[OK] Inserted fixMojibake() helper." -ForegroundColor Green
} else {
  Write-Host "[OK] fixMojibake() helper already present." -ForegroundColor Green
}

# Patch the specific "Code:" span so its expression is wrapped:
# Code: <span ...>{EXPR}</span>  -> Code: <span ...>{fixMojibake(EXPR)}</span>
$pattern = '(?ms)(Code:\s*<span\b[^>]*>)\s*\{([\s\S]*?)\}\s*(</span>)'
if (-not ([regex]::IsMatch($txt, $pattern))) {
  Fail "Could not find the Code:<span>{...}</span> pattern in TripLifecycleActions.tsx."
}

$patched = [regex]::Replace($txt, $pattern, '$1{fixMojibake($2)}$3', 1)

if ($patched -eq $txt) { Fail "No change produced (unexpected)." }

Set-Content -Path $file -Value $patched -Encoding UTF8
Write-Host "[OK] Patched Trip actions Code: to fix mojibake (display-only)." -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) /admin/livetrips -> Trip actions -> Code should be readable now" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback (if needed):" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
