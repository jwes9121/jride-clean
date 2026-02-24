param(
  [Parameter(Mandatory=$true)][string]$ProjRoot,
  [ValidateSet("report","fix")][string]$Mode = "fix"
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

$target = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] File not found: $target" }

Info "== JRIDE LiveTrips ASCII sanitize (V2 / PS5-safe) =="
Info "Root : $ProjRoot"
Info "File : $target"
Info "Mode : $Mode"
Write-Host ""

# Read bytes first so we can explicitly detect/remove BOM
$bytes0 = [System.IO.File]::ReadAllBytes($target)
$hasBom = ($bytes0.Length -ge 3 -and $bytes0[0] -eq 0xEF -and $bytes0[1] -eq 0xBB -and $bytes0[2] -eq 0xBF)
if ($hasBom) { Warn "[WARN] UTF-8 BOM detected at file start (EF BB BF)." }

# Decode as UTF-8 (will include BOM as U+FEFF if present)
$rawText = [System.Text.Encoding]::UTF8.GetString($bytes0)

# Strip BOM char if present
if ($rawText.Length -gt 0 -and [int][char]$rawText[0] -eq 0xFEFF) {
  $rawText = $rawText.Substring(1)
  Warn "[WARN] Removed BOM character U+FEFF from text."
}

function Get-NonAsciiFindings([string]$text) {
  $findings = New-Object System.Collections.Generic.List[object]
  $line = 1
  $col = 0
  for ($i=0; $i -lt $text.Length; $i++) {
    $ch = $text[$i]
    if ($ch -eq "`n") { $line++; $col = 0; continue }
    $col++

    $code = [int][char]$ch
    if ($code -gt 127) {
      $hex = ("0x{0:X4}" -f $code)
      $display = $ch
      if ($code -eq 160) { $display = "<NBSP>" }
      $findings.Add([pscustomobject]@{
        Line = $line
        Col  = $col
        CodePoint = $hex
        Char = $display
      }) | Out-Null
    }
  }
  return $findings
}

$find0 = Get-NonAsciiFindings $rawText
if ($find0.Count -eq 0 -and -not $hasBom) {
  Ok "[OK] Already ASCII-clean (no BOM, no non-ASCII)."
  exit 0
}

if ($find0.Count -gt 0) {
  Warn ("[WARN] Found {0} non-ASCII character(s)." -f $find0.Count)
  $find0 | Select-Object -First 80 | Format-Table -AutoSize | Out-String | Write-Host
  if ($find0.Count -gt 80) { Warn ("... and {0} more." -f ($find0.Count - 80)) }
} else {
  Warn "[WARN] No non-ASCII chars, but BOM still present."
}

if ($Mode -eq "report") {
  Warn "[REPORT ONLY] Not modifying the file."
  exit 0
}

# Replacement map (includes ≥ and dashes)
$map = @{
  ([char]0x2265) = ">=";  # ≥
  ([char]0x2018) = "'";   # ‘
  ([char]0x2019) = "'";   # ’
  ([char]0x201C) = '"';   # “
  ([char]0x201D) = '"';   # ”
  ([char]0x2013) = "-";   # –
  ([char]0x2014) = "-";   # —
  ([char]0x2026) = "..."; # …
  ([char]0x00A0) = " ";   # NBSP
  ([char]0x2022) = "*";   # •
  ([char]0x00B7) = "*";   # ·
}

$fixed = New-Object System.Text.StringBuilder
$changed = 0
$unknown = 0

for ($i=0; $i -lt $rawText.Length; $i++) {
  $ch = $rawText[$i]
  $code = [int][char]$ch

  if ($code -le 127) {
    [void]$fixed.Append($ch)
    continue
  }

  if ($map.ContainsKey($ch)) {
    [void]$fixed.Append($map[$ch])
    $changed++
  } else {
    [void]$fixed.Append(" ")
    $unknown++
  }
}

if ($changed -gt 0) { Ok ("[OK] Replaced {0} known non-ASCII character(s) using mapping." -f $changed) }
if ($unknown -gt 0) { Warn ("[WARN] Replaced {0} UNKNOWN non-ASCII character(s) with a space (see report above)." -f $unknown) }

# Write UTF-8 WITHOUT BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $fixed.ToString(), $utf8NoBom)
Ok "[OK] Wrote file as UTF-8 (no BOM)."

# Verify ASCII-only bytes
$bytes = [System.IO.File]::ReadAllBytes($target)
$bad = @()
for ($i=0; $i -lt $bytes.Length; $i++) {
  if ($bytes[$i] -gt 127) { $bad += $i; if ($bad.Count -ge 30) { break } }
}
if ($bad.Count -gt 0) {
  Fail ("[FAIL] Still found non-ASCII bytes after fix. First byte offsets: {0}" -f ($bad -join ", "))
}

Ok "[OK] ASCII verification passed (no bytes > 127)."
Ok "[NEXT] Run: npm.cmd run build"