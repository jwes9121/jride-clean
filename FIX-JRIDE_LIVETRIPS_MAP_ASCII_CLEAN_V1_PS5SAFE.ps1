# FIX-JRIDE_LIVETRIPS_MAP_ASCII_CLEAN_V1_PS5SAFE.ps1
# Purpose:
# - Fix npm prebuild failure: scripts/check-livetrips-ascii.js reports Non-ASCII bytes in:
#     app/admin/livetrips/components/LiveTripsMap.tsx
# - Normalize common smart punctuation / NBSP to ASCII
# - Remove UTF-8 BOM (if any)
# - Write UTF-8 *without BOM*
# - Re-verify file is ASCII-only
# - Run: npm.cmd run build
#
# PS5-safe. Backups included.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$ProjRoot = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok([string]$m) { Write-Host $m -ForegroundColor Green }
function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }

function Ensure-Dir([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
  }
}

function Get-Timestamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }

function Remove-Utf8BomBytes([byte[]]$bytes) {
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    return ,($bytes[3..($bytes.Length-1)])
  }
  return ,$bytes
}

function Has-NonAsciiBytes([byte[]]$bytes) {
  foreach ($b in $bytes) { if ($b -gt 127) { return $true } }
  return $false
}

function List-NonAsciiBytes([byte[]]$bytes, [int]$max = 40) {
  $hits = @()
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    $b = $bytes[$i]
    if ($b -gt 127) {
      $hits += ("idx={0} byte=0x{1}" -f $i, $b.ToString("X2"))
      if ($hits.Count -ge $max) { break }
    }
  }
  return $hits
}

function Normalize-ToAscii([string]$text) {
  $map = New-Object "System.Collections.Generic.Dictionary[string,string]"

  # Smart quotes
  $map.Add([char]0x201C, '"') # “
  $map.Add([char]0x201D, '"') # ”
  $map.Add([char]0x201E, '"') # „
  $map.Add([char]0x2033, '"') # ″
  $map.Add([char]0x00AB, '"') # «
  $map.Add([char]0x00BB, '"') # »

  $map.Add([char]0x2018, "'") # ‘
  $map.Add([char]0x2019, "'") # ’
  $map.Add([char]0x201A, "'") # ‚
  $map.Add([char]0x2032, "'") # ′

  # Dashes
  $map.Add([char]0x2013, "-") # –
  $map.Add([char]0x2014, "-") # —
  $map.Add([char]0x2212, "-") # −

  # Ellipsis
  $map.Add([char]0x2026, "...") # …

  # Spaces
  $map.Add([char]0x00A0, " ") # NBSP
  $map.Add([char]0x2007, " ") # Figure space
  $map.Add([char]0x202F, " ") # Narrow NBSP
  $map.Add([char]0x2009, " ") # Thin space
  $map.Add([char]0x200A, " ") # Hair space
  $map.Add([char]0x200B, "")  # Zero-width space
  $map.Add([char]0xFEFF, "")  # BOM as char (ZWNBSP)

  # Bullets / dots
  $map.Add([char]0x2022, "*") # •
  $map.Add([char]0x00B7, "*") # ·

  # Misc
  $map.Add([char]0x00D7, "x") # ×

  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $text.Length; $i++) {
    $ch = $text[$i]
    $k = [string]$ch
    if ($map.ContainsKey($k)) {
      [void]$sb.Append($map[$k])
      continue
    }
    $code = [int][char]$ch
    if ($code -le 127) {
      [void]$sb.Append($ch)
    } else {
      # last resort: replace unknown non-ascii with '?'
      [void]$sb.Append("?")
    }
  }
  return $sb.ToString()
}

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

# ---------------- Main ----------------

Info "== JRIDE LiveTripsMap ASCII Clean (V1 / PS5-safe) =="
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Info ("Repo: {0}" -f $root)

$target = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"
if (-not (Test-Path -LiteralPath $target)) {
  Fail ("[FAIL] Target file not found: {0}" -f $target)
}

$bakDir = Join-Path $root "_patch_bak"
Ensure-Dir $bakDir

$ts = Get-Timestamp
$bak = Join-Path $bakDir ("LiveTripsMap.tsx.bak.ASCII_CLEAN_V1.{0}" -f $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$bytes = [System.IO.File]::ReadAllBytes($target)
$bytesNoBom = Remove-Utf8BomBytes $bytes
if ($bytes.Length -ne $bytesNoBom.Length) { Ok "[OK] Removed UTF-8 BOM bytes (if present)" }

if (-not (Has-NonAsciiBytes $bytesNoBom)) {
  Ok "[OK] File is already ASCII-only (after BOM removal)."
} else {
  $hits = List-NonAsciiBytes $bytesNoBom 30
  Info "[INFO] Sample non-ASCII bytes (first hits):"
  foreach ($h in $hits) { Write-Host ("  - {0}" -f $h) }

  $utf8 = New-Object System.Text.UTF8Encoding($true, $false)
  $text = $utf8.GetString($bytesNoBom)
  $normalized = Normalize-ToAscii $text

  Write-Utf8NoBom $target $normalized
  Ok ("[OK] Normalized to ASCII + wrote UTF-8 (no BOM): {0}" -f $target)

  $bytes2 = [System.IO.File]::ReadAllBytes($target)
  $bytes2NoBom = Remove-Utf8BomBytes $bytes2
  if (Has-NonAsciiBytes $bytes2NoBom) {
    $hits2 = List-NonAsciiBytes $bytes2NoBom 30
    Info "[INFO] Still has non-ASCII bytes after normalization (sample):"
    foreach ($h in $hits2) { Write-Host ("  - {0}" -f $h) }
    Fail "[FAIL] ASCII normalization did not fully remove non-ASCII bytes."
  } else {
    Ok "[OK] Verified: LiveTripsMap.tsx is now ASCII-only (and no BOM)."
  }
}

Info "== Running build =="
Push-Location $root
try {
  & npm.cmd run build
  Ok "[OK] npm run build succeeded"
} finally {
  Pop-Location
}

Ok "== Done =="
Ok "Next: git commit + tag + push (commands below)"