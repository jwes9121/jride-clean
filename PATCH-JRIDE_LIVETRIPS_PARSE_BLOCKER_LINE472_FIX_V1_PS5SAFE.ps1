param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host $m -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }

$target = Join-Path $RepoRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path $target)) {
  throw "Target file not found: $target"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.PARSE_FIX_V1.$stamp"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Ok "[OK] Backup: $bak"

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# Show the failing neighborhood for transparency
$lines = $content -split "`r?`n"
$start = [Math]::Max(0, 468)
$end = [Math]::Min($lines.Length - 1, 476)
Write-Info "---- Current lines 469-477 ----"
for ($i = $start; $i -le $end; $i++) {
  $ln = $i + 1
  Write-Host ("{0}: {1}" -f $ln, $lines[$i])
}
Write-Info "--------------------------------"

# Normalize non-ASCII and parser-hostile symbols commonly pasted into JSX text
$map = @{
  [string][char]0x2018 = "'"
  [string][char]0x2019 = "'"
  [string][char]0x201C = '"'
  [string][char]0x201D = '"'
  [string][char]0x2013 = "-"
  [string][char]0x2014 = "-"
  [string][char]0x2026 = "..."
  [string][char]0x2265 = ">="
  [string][char]0x2264 = "<="
  [string][char]0x2192 = "->"
  [string][char]0x00A0 = " "
}
foreach ($k in $map.Keys) {
  $content = $content.Replace($k, $map[$k])
}

# The specific JSX parser error usually happens when a raw '>' is in text content.
# Replace plain text comparisons with JSX-safe entities.
$content = [regex]::Replace($content, '>(\s*)>=(\s*)<', '>$1&gt;=$2<')
$content = [regex]::Replace($content, '>(\s*)>(\s*)<', '>$1&gt;$2<')
$content = [regex]::Replace($content, '>(\s*)<=(\s*)<', '>$1&lt;=$2<')
$content = [regex]::Replace($content, '>(\s*)<(\s*)<', '>$1&lt;$2<')

# Also repair common raw text fragments inside JSX nodes/ternaries
$content = $content -replace '\b([0-9]+)\s*>=\s*([0-9]+)\b', '$1 &gt;= $2'
$content = $content -replace '\b([0-9]+)\s*<=\s*([0-9]+)\b', '$1 &lt;= $2'
$content = $content -replace '\b([0-9]+)\s*>\s*([0-9]+)\b', '$1 &gt; $2'
$content = $content -replace '\b([0-9]+)\s*<\s*([0-9]+)\b', '$1 &lt; $2'

# Strip any remaining non-ASCII bytes to satisfy prebuild checker
$content = [regex]::Replace($content, '[^\x00-\x7F]', '')

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
Write-Ok "[OK] Wrote ASCII-safe file: $target"

$lines2 = (Get-Content -LiteralPath $target -Raw -Encoding UTF8) -split "`r?`n"
$start2 = [Math]::Max(0, 468)
$end2 = [Math]::Min($lines2.Length - 1, 476)
Write-Info "---- New lines 469-477 ----"
for ($i = $start2; $i -le $end2; $i++) {
  $ln = $i + 1
  Write-Host ("{0}: {1}" -f $ln, $lines2[$i])
}
Write-Info "---------------------------"

Write-Host ""
Write-Info "Next command"
Write-Host "npm run build"
