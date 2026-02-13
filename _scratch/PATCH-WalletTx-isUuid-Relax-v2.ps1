# PATCH-WalletTx-isUuid-Relax-v2.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$repo = (Get-Location).Path
$rel  = "app\api\admin\wallet\transactions\route.ts"
$path = Join-Path $repo $rel
if (-not (Test-Path $path)) { Fail "File not found: $path" }

$txt = Get-Content $path -Raw

# Guard: must have isUuid function
if ($txt -notmatch '(?m)^\s*function\s+isUuid\s*\(') {
  Fail "Could not find 'function isUuid(' in $rel. Aborting."
}

# We will only touch the return-line inside function isUuid that contains .test(v)
$lines = $txt -split "`r?`n"

$inIsUuid = $false
$returnIdx = -1

for ($i=0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]

  if ($line -match '^\s*function\s+isUuid\s*\(') { $inIsUuid = $true }

  if ($inIsUuid -and $returnIdx -lt 0) {
    if ($line -match '^\s*return\s+/.*/i\.test\(\s*v\s*\)\s*;?\s*$') {
      $returnIdx = $i
    }
  }

  if ($inIsUuid -and $line -match '^\s*\}\s*$') { $inIsUuid = $false }
}

if ($returnIdx -lt 0) {
  Fail "Found function isUuid but could not locate a return line like: return /.../i.test(v);"
}

$oldLine = $lines[$returnIdx]

# Desired relaxed validator: any UUID-like 8-4-4-4-12 hex (accepts your 1111... ids too)
$relaxed = 'return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);'

# Preserve indentation
$indent = ""
if ($oldLine -match '^(\s*)') { $indent = $Matches[1] }
$newLine = $indent + $relaxed

# Decide what to do
if ($oldLine -eq $newLine) {
  Write-Host "[OK] ${rel} already uses relaxed UUID validation. No patch needed." -ForegroundColor Green
} else {
  $lines[$returnIdx] = $newLine
  $txt2 = ($lines -join "`r`n")
  Set-Content -Path $path -Value $txt2 -Encoding UTF8
  Write-Host "[OK] Patched ${rel} isUuid() to accept any UUID-like 8-4-4-4-12 hex." -ForegroundColor Green
  Write-Host "     Old: $oldLine" -ForegroundColor DarkGray
  Write-Host "     New: $newLine" -ForegroundColor DarkGray
}

Write-Host "`n[STEP] npm run build" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Paste build output (one file at a time)." }

Write-Host "`n[OK] Build passed. Testing endpoint..." -ForegroundColor Green

$base = "http://localhost:3000"
$testUrl = "$base/api/admin/wallet/transactions?kind=vendor&id=11111111-1111-1111-1111-111111111111&limit=10"
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
