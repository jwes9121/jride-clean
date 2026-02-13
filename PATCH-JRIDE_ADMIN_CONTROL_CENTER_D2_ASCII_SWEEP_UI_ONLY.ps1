# PATCH-JRIDE_ADMIN_CONTROL_CENTER_D2_ASCII_SWEEP_UI_ONLY.ps1
# UI-ONLY: Replace common mojibake/smart punctuation with ASCII and FAIL if any non-ASCII remains.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\control-center\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

# Read bytes so we can detect/remove BOM reliably
$bytes = [System.IO.File]::ReadAllBytes($target)

# Strip UTF-8 BOM if present (EF BB BF)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  $bytes = $bytes[3..($bytes.Length-1)]
  Write-Host "[OK] Removed UTF-8 BOM"
}

$txt = [System.Text.Encoding]::UTF8.GetString($bytes)

# Helper to create a string from a single unicode codepoint without embedding the literal
function U([int]$code) { return [string][char]$code }

# Replace common non-ASCII punctuation with ASCII equivalents
$repls = @(
  @{ from = (U 0x2018); to = "'" },   # left single quote
  @{ from = (U 0x2019); to = "'" },   # right single quote
  @{ from = (U 0x201C); to = '"' },   # left double quote
  @{ from = (U 0x201D); to = '"' },   # right double quote
  @{ from = (U 0x2013); to = "-" },   # en dash
  @{ from = (U 0x2014); to = "-" },   # em dash
  @{ from = (U 0x2026); to = "..." }, # ellipsis
  @{ from = (U 0x00A0); to = " " }    # non-breaking space
)

$before = $txt
foreach ($r in $repls) {
  $txt = $txt.Replace($r.from, $r.to)
}

# Validate ASCII (allow: tab/newline/carriage return + printable ASCII)
$bad = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $txt.Length; $i++) {
  $c = [int][char]$txt[$i]
  $ok =
    ($c -eq 9) -or ($c -eq 10) -or ($c -eq 13) -or
    ($c -ge 32 -and $c -le 126)
  if (-not $ok) {
    $hex = "0x{0:X4}" -f $c
    $bad.Add(("{0}:{1}" -f $i, $hex))
    if ($bad.Count -ge 12) { break }
  }
}

if ($bad.Count -gt 0) {
  Fail ("Non-ASCII characters still present after sweep. First occurrences: " + ($bad -join ", "))
}

if ($txt -eq $before) {
  Write-Host "[OK] No changes needed (already ASCII-safe)."
} else {
  Write-Host "[OK] Applied ASCII-safe replacements."
}

# Write back as UTF-8 WITHOUT BOM
[System.IO.File]::WriteAllBytes($target, [System.Text.Encoding]::UTF8.GetBytes($txt))
Write-Host "[OK] Wrote UTF-8 (no BOM): $target"

Write-Host ""
Write-Host "Run build:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Commit/tag suggestion:"
Write-Host "  chore(admin-control-center): D2 ascii sweep (UI only)"
Write-Host "  JRIDE_ADMIN_CONTROL_CENTER_D2_ASCII_GREEN"
