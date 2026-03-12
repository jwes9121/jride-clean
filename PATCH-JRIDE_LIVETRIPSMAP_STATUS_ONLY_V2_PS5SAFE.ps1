param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  $bakDir = Join-Path $RepoRoot '_patch_bak'
  if (!(Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $bakPath = Join-Path $bakDir ((Split-Path $Path -Leaf) + '.bak.' + $Tag + '.' + $stamp)
  Copy-Item $Path $bakPath -Force
  Write-Host "[OK] Backup: $bakPath"
}

function Replace-Regex-OrFail {
  param(
    [Parameter(Mandatory=$true)][string]$Content,
    [Parameter(Mandatory=$true)][string]$Pattern,
    [Parameter(Mandatory=$true)][string]$Replacement,
    [Parameter(Mandatory=$true)][string]$Label
  )
  $newContent = [System.Text.RegularExpressions.Regex]::Replace(
    $Content,
    $Pattern,
    $Replacement,
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if ($newContent -eq $Content) {
    throw "Patch anchor not found for: $Label"
  }
  Write-Host "[OK] Patched: $Label"
  return $newContent
}

Write-Host '== PATCH JRIDE LIVETRIPSMAP STATUS ONLY V2 (PS5-safe) =='
Write-Host "RepoRoot: $RepoRoot"

$mapPath = Join-Path $RepoRoot 'app\admin\livetrips\components\LiveTripsMap.tsx'
if (!(Test-Path $mapPath)) {
  throw "File not found: $mapPath"
}

Backup-File -Path $mapPath -Tag 'LIVETRIPSMAP_STATUS_ONLY_V2'

$content = Get-Content -LiteralPath $mapPath -Raw

# Normalize file if BOM exists on first char
if ($content.Length -gt 0 -and [int][char]$content[0] -eq 65279) {
  $content = $content.Substring(1)
}

$content = Replace-Regex-OrFail -Content $content `
  -Pattern '\[\s*"pending"\s*,\s*"assigned"\s*,\s*"on_the_way"\s*,\s*"on_trip"\s*\]\.includes\(status\)' `
  -Replacement '["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"].includes(status)' `
  -Label 'Map KPI active states'

$content = Replace-Regex-OrFail -Content $content `
  -Pattern '\[\s*"pending"\s*,\s*"assigned"\s*\]\.includes\(status\)' `
  -Replacement '["assigned", "accepted", "fare_proposed", "ready"].includes(status)' `
  -Label 'Map pending queue states'

$content = Replace-Regex-OrFail -Content $content `
  -Pattern '\[\s*"pending"\s*,\s*"assigned"\s*\]\.includes\(\(t\.status\s*\?\?\s*""\)\.toString\(\)\)' `
  -Replacement '["assigned", "accepted", "fare_proposed", "ready"].includes((t.status ?? "").toString())' `
  -Label 'Map suggestion candidate states'

$content = Replace-Regex-OrFail -Content $content `
  -Pattern '\[\s*"idle"\s*,\s*"available"\s*,\s*"on_the_way"\s*,\s*"on_trip"\s*\]\.includes\(' `
  -Replacement '["idle", "available", "online", "on_the_way", "on_trip"].includes(' `
  -Label 'Map driver pool states include online'

Write-Utf8NoBom -Path $mapPath -Content $content
Write-Host "[OK] Wrote: $mapPath"
Write-Host '[DONE] LiveTripsMap status normalization patch applied.'
