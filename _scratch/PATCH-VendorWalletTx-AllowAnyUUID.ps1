# PATCH-VendorWalletTx-AllowAnyUUID.ps1
$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

$repo = (Get-Location).Path
$rel  = "app\api\admin\wallet\transactions\route.ts"
$path = Join-Path $repo $rel

if (-not (Test-Path $path)) { Fail "File not found: $path" }

$txt = Get-Content $path -Raw

# We only patch the isUuid() function, nothing else.
# OLD (strict RFC variant): return /^[0-9a-f]{8}-...-[89ab]...$/i.test(v);
# NEW (relaxed):           return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
$rxIsUuid = '(?s)function\s+isUuid\s*\(\s*v\s*:\s*string\s*\)\s*\{\s*return\s+\/\^[^;]+;\s*\}'
if ($txt -notmatch $rxIsUuid) {
  Fail "Could not locate function isUuid(v: string) { return /.../.test(v); } in $rel. Refusing to guess."
}

$replacement = @'
function isUuid(v: string) {
  // Accept ANY UUID-like 8-4-4-4-12 hex (DB already contains non-RFC variant IDs like 1111...).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
'@

$txt2 = [regex]::Replace($txt, $rxIsUuid, $replacement, 1)

if ($txt2 -eq $txt) { Fail "No change produced (unexpected). Aborting." }

Set-Content -Path $path -Value $txt2 -Encoding UTF8

Write-Host "[OK] Patched isUuid() in ${rel} to accept any UUID-like hex." -ForegroundColor Green

Write-Host "`n[STEP] Running build..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Fix build first before continuing." }

Write-Host "`n[OK] Build passed." -ForegroundColor Green

# Quick live test (local)
$base = "http://localhost:3000"
$testUrl = "$base/api/admin/wallet/transactions?kind=vendor&id=11111111-1111-1111-1111-111111111111&limit=10"

Write-Host "`n[STEP] Testing vendor ledger endpoint:" -ForegroundColor Cyan
Write-Host $testUrl -ForegroundColor Gray

try {
  $res = Invoke-RestMethod -Method GET -Uri $testUrl
  "[RESPONSE] 200"
  $res | ConvertTo-Json -Depth 6
} catch {
  "[RESPONSE] HTTP error:"
  if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
    $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $raw = $sr.ReadToEnd()
    $sr.Close()
    $raw
  } else {
    $_.Exception.Message
  }
}
