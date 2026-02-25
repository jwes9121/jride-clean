param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

$ProjRoot = (Resolve-Path $ProjRoot).Path
$f = Join-Path $ProjRoot "app\ride\page.tsx"
if (!(Test-Path $f)) { throw ("Missing file: " + $f) }

$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("page.tsx.bak.FEES_ACK_ENABLE_TICK_V1." + $ts)
Copy-Item -LiteralPath $f -Destination $bak -Force
Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green

$txt = Get-Content -LiteralPath $f -Raw

# Replace ONLY the checkbox disable line used in the P9 fees ack block
# Accept whitespace variations.
$pattern = 'disabled=\{\s*busy\s*\|\|\s*bookingSubmitted\s*\}'
if ($txt -notmatch $pattern) {
  throw "Pattern not found: disabled={busy || bookingSubmitted}. No change applied."
}

$txt2 = [regex]::Replace($txt, $pattern, 'disabled={busy}', 1)

# Write UTF-8 no BOM (avoid the BOM problem you hit earlier)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $txt2, $utf8NoBom)

Write-Host "[OK] Patched: disabled={busy || bookingSubmitted} -> disabled={busy}" -ForegroundColor Green