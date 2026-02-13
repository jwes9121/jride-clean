# PATCH-JRIDE_PHASE10A1_FIX_AT_RISK_MOJIBAKE_HEX.ps1
# ASCII-only patch: removes mojibake from app\admin\trips\at-risk\page.tsx using HEX byte replacement.
# Fixes: "-" => " - ", "·" => " | ", stray "" => ""
# Backup: .bak.<timestamp>
# Encoding: writes UTF-8

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host $m -ForegroundColor Green }

function HexToBytes([string]$hex) {
  $clean = ($hex -replace '\s+', '')
  if (($clean.Length % 2) -ne 0) { Fail "Hex string must have even length: $hex" }
  $bytes = New-Object byte[] ($clean.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($clean.Substring($i*2, 2), 16)
  }
  return $bytes
}

function ReplaceBytesAll([byte[]]$src, [byte[]]$find, [byte[]]$repl) {
  if ($find.Length -eq 0) { return $src }

  $ms = New-Object System.IO.MemoryStream
  $i = 0
  while ($i -le ($src.Length - $find.Length)) {
    $match = $true
    for ($j = 0; $j -lt $find.Length; $j++) {
      if ($src[$i + $j] -ne $find[$j]) { $match = $false; break }
    }

    if ($match) {
      if ($repl.Length -gt 0) { $ms.Write($repl, 0, $repl.Length) }
      $i += $find.Length
    } else {
      $ms.WriteByte($src[$i])
      $i++
    }
  }

  # write remaining tail
  while ($i -lt $src.Length) {
    $ms.WriteByte($src[$i])
    $i++
  }

  return $ms.ToArray()
}

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\trips\at-risk\page.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"

Copy-Item -LiteralPath $target -Destination $bak -Force
Info "[OK] Backup: $bak"

$bytes = [System.IO.File]::ReadAllBytes($target)
$origLen = $bytes.Length

# Patterns (UTF-8 bytes of the *mojibake text* shown in UI)
# "-" is 3 chars: â (U+00E2) + € (U+20AC) + ” (U+201D)
$P_EMDASH_MOJIBAKE = HexToBytes "C3 A2 E2 82 AC E2 80 9D"
# "·" is 2 chars:  (U+00C2) + · (U+00B7)
$P_NBSP_DOT = HexToBytes "C3 82 C2 B7"
# stray ""
$P_A_ONLY = HexToBytes "C3 82"

$R_DASH = [System.Text.Encoding]::UTF8.GetBytes(" - ")
$R_PIPE = [System.Text.Encoding]::UTF8.GetBytes(" | ")
$R_EMPTY = New-Object byte[] 0

# Apply replacements
$bytes = ReplaceBytesAll $bytes $P_EMDASH_MOJIBAKE $R_DASH
$bytes = ReplaceBytesAll $bytes $P_NBSP_DOT $R_PIPE
$bytes = ReplaceBytesAll $bytes $P_A_ONLY $R_EMPTY

# Write back (UTF-8)
[System.IO.File]::WriteAllBytes($target, $bytes)

Ok "[DONE] Patched: $target"
Ok ("[DONE] Size: {0} -> {1} bytes" -f $origLen, $bytes.Length)
