<# 
FIX-JRIDE_LIVETRIPS_ASCII_SANITIZE_V2_PS5SAFE.ps1

Fix:
  Your V1 failed because .Replace(char, char) can't replace with "..." (3 chars).
  V2 handles ellipsis using Replace(string,string), and keeps the rest PS5-safe.

Purpose:
  Remove NON-ASCII bytes from:
    <ProjRoot>\app\admin\livetrips\LiveTripsClient.tsx
  so scripts/check-livetrips-ascii.js and pre-commit pass -> commit/push -> Vercel builds.

Behavior:
  - Creates a timestamped backup
  - Reports non-ASCII sample (index + U+XXXX + char)
  - Replaces common unicode punctuation with ASCII equivalents (string-safe)
  - Removes any remaining non-ASCII chars
  - Writes UTF-8 (no BOM)

PS5-safe.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ProjRoot,

  [int]$ReportLimit = 80
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host $m -ForegroundColor Red; throw $m }

function Normalize-Path([string]$p) {
  try { return (Resolve-Path -LiteralPath $p).Path } catch { return $p }
}

function Read-TextUtf8NoBom([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { Fail "File not found: $path" }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-TextUtf8NoBom([string]$path, [string]$text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

function Backup-File([string]$path, [string]$tag) {
  $dir = Split-Path -Parent $path
  $name = Split-Path -Leaf $path
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak = Join-Path $dir ("{0}.bak.{1}.{2}" -f $name, $tag, $stamp)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok ("[OK] Backup: {0}" -f $bak)
  return $bak
}

function Get-NonAsciiReport([string]$text, [int]$limit) {
  $hits = New-Object System.Collections.Generic.List[object]
  $count = 0
  for ($i = 0; $i -lt $text.Length; $i++) {
    $cp = [int][char]$text[$i]
    if ($cp -gt 127) {
      $count++
      if ($hits.Count -lt $limit) {
        $ch = $text[$i]
        $u = ("U+{0:X4}" -f $cp)
        $hits.Add([pscustomobject]@{ Index=$i; CodePoint=$u; Char=$ch })
      }
    }
  }
  return [pscustomobject]@{ Total=$count; Sample=$hits }
}

Info "== JRIDE LiveTrips: ASCII sanitize (V2 / PS5-safe) =="

$ProjRoot = Normalize-Path $ProjRoot
Info ("Repo: {0}" -f $ProjRoot)

$target = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
$target = Normalize-Path $target
Info ("Target: {0}" -f $target)

if (!(Test-Path -LiteralPath $target)) {
  Fail "Target file not found. Expected: $target"
}

$content = Read-TextUtf8NoBom $target
$rep = Get-NonAsciiReport $content $ReportLimit

if ($rep.Total -le 0) {
  Ok "[OK] No non-ASCII characters found. Nothing to do."
  exit 0
}

Warn ("[WARN] Found non-ASCII chars: {0}" -f $rep.Total)
Info "Sample (first $ReportLimit):"
$rep.Sample | Format-Table -AutoSize | Out-String | Write-Host

Backup-File $target "LIVETRIPS_ASCII_SANITIZE_V2" | Out-Null

# Replace common unicode punctuation with ASCII equivalents.
# IMPORTANT: Use string.Replace(string,string) so "..." is allowed.
$fixed = $content

$fixed = $fixed.Replace([string][char]0x2018, "'")   # ‘
$fixed = $fixed.Replace([string][char]0x2019, "'")   # ’
$fixed = $fixed.Replace([string][char]0x201C, '"')   # “
$fixed = $fixed.Replace([string][char]0x201D, '"')   # ”
$fixed = $fixed.Replace([string][char]0x2013, "-")   # –
$fixed = $fixed.Replace([string][char]0x2014, "-")   # —
$fixed = $fixed.Replace([string][char]0x2026, "...") # …
$fixed = $fixed.Replace([string][char]0x00A0, " ")   # NBSP

# Then drop any remaining non-ASCII chars.
$sb = New-Object System.Text.StringBuilder
$removed = 0
for ($i = 0; $i -lt $fixed.Length; $i++) {
  $cp = [int][char]$fixed[$i]
  if ($cp -le 127) {
    [void]$sb.Append($fixed[$i])
  } else {
    $removed++
  }
}
$fixed2 = $sb.ToString()

Write-TextUtf8NoBom $target $fixed2

$rep2 = Get-NonAsciiReport $fixed2 $ReportLimit
if ($rep2.Total -eq 0) {
  Ok ("[OK] Sanitized. Removed remaining non-ASCII chars: {0}" -f $removed)
  Ok "[OK] File is now ASCII-clean (UTF-8 no BOM)."
} else {
  Warn ("[WARN] Still found non-ASCII after sanitize: {0}" -f $rep2.Total)
  Warn "Sample of remaining:"
  $rep2.Sample | Format-Table -AutoSize | Out-String | Write-Host
  Warn "You must reach 0 for the hook to pass."
}

Info "Done."