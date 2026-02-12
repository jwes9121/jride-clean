param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

$target = Join-Path $ProjRoot "app\api\dispatch\assign\route.ts"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Not found: $target" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("dispatch-assign.route.ts.bak.REMOVE_PS_GARBAGE_V1.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

# Read bytes; strip UTF-8 BOM if present (mojibake prevention)
$bytes = [System.IO.File]::ReadAllBytes($target)
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
if ($hasBom) {
  $bytes = $bytes[3..($bytes.Length-1)]
  Ok "[OK] Removed UTF-8 BOM"
}
$txt = [System.Text.Encoding]::UTF8.GetString($bytes)

$before = $txt

# Remove the accidental PowerShell line(s) inserted into TS
# Exact line observed:
# foreach ($null in @()) { } # no-op; keep PS parser calm in here-string
$pat1 = '(?m)^\s*foreach\s*\(\s*\$null\s+in\s+@\(\)\s*\)\s*\{\s*\}\s*(#.*)?\s*\r?\n?'
$txt = [regex]::Replace($txt, $pat1, "")

# Also remove any other stray "$null" / "@()" lines that might have slipped in
$pat2 = '(?m)^\s*\$null\s*=.*\r?\n?'
$txt = [regex]::Replace($txt, $pat2, "")

if ($txt -eq $before) {
  Warn "[WARN] No PowerShell garbage lines found (maybe already cleaned)."
} else {
  Ok "[OK] Removed accidental PowerShell garbage line(s) from TypeScript"
}

# Write UTF-8 NO BOM
[System.IO.File]::WriteAllText($target, $txt, (New-Object System.Text.UTF8Encoding($false)))
Ok ("[OK] Updated: {0}" -f $target)

Ok "[OK] Fix complete."
