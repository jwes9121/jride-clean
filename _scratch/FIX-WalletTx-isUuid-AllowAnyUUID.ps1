# FIX-WalletTx-isUuid-AllowAnyUUID.ps1
$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

$rel  = "app\api\admin\wallet\transactions\route.ts"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "Missing file: $rel (run from repo root)" }

$txt = Get-Content -Raw -Path $path

# Must find the isUuid function
$rx = '(?ms)function\s+isUuid\s*\(\s*v\s*:\s*string\s*\)\s*\{\s*return\s+\/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i\.test\(v\);\s*\}'
if ($txt -notmatch $rx) {
  Fail "Could not locate the expected isUuid() implementation to patch in $rel."
}

$replacement = @'
function isUuid(v: string) {
  // Accept ANY UUID version/variant (we use 1111... test vendor ids in dev)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
'@

$txt2 = [regex]::Replace($txt, $rx, $replacement)

if ($txt2 -eq $txt) { Fail "Patch produced no changes (unexpected)." }

Set-Content -Path $path -Value $txt2 -Encoding UTF8
Write-Host ("[OK] Patched isUuid() in {0} to accept any UUID." -f $rel) -ForegroundColor Green
Write-Host "[NEXT] npm run build" -ForegroundColor Cyan
