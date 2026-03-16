param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$m) { Write-Host $m -ForegroundColor Green }
function Write-Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Write-Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }

$targets = @(
  "app\admin\livetrips\components\LiveTripsMap.tsx",
  "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"
)

$resolvedRoot = (Resolve-Path $RepoRoot).Path
Write-Info "== JRIDE ASCII CLEANUP FOR RESTORED LIVETRIPS COMPONENTS =="
Write-Info "RepoRoot: $resolvedRoot"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

foreach ($rel in $targets) {
  $path = Join-Path $resolvedRoot $rel
  if (-not (Test-Path $path)) {
    throw "Target file not found: $path"
  }

  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.ASCII_REPAIR_V1.$stamp"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Ok "[OK] Backup: $bak"

  $content = [System.IO.File]::ReadAllText($path)

  # Normalize common Unicode punctuation/symbols to ASCII
  $map = @{
    ([string][char]0x2018) = "'"
    ([string][char]0x2019) = "'"
    ([string][char]0x201C) = '"'
    ([string][char]0x201D) = '"'
    ([string][char]0x2013) = "-"
    ([string][char]0x2014) = "-"
    ([string][char]0x2026) = "..."
    ([string][char]0x00A0) = " "
    ([string][char]0x2192) = "->"
    ([string][char]0x2265) = ">="
    ([string][char]0x2264) = "<="
  }
  foreach ($k in $map.Keys) {
    $content = $content.Replace($k, $map[$k])
  }

  # Strip any remaining non-ASCII bytes/characters
  $content = [regex]::Replace($content, '[^\x00-\x7F]', '')

  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  Write-Ok "[OK] Wrote ASCII-safe file: $path"
}

Write-Host ""
Write-Info "Next command"
Write-Host "npm run build"
