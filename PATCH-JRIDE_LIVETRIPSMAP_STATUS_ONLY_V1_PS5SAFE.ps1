param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param([string]$Path,[string]$Content)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Backup-File {
  param([string]$Path,[string]$Tag)
  $bakDir = Join-Path $RepoRoot '_patch_bak'
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $dest = Join-Path $bakDir ((Split-Path $Path -Leaf) + '.bak.' + $Tag + '.' + $stamp)
  Copy-Item $Path $dest -Force
  Write-Host "[OK] Backup: $dest"
}

function Replace-OrFail {
  param(
    [string]$Content,
    [string]$Old,
    [string]$New,
    [string]$Label
  )
  if ($Content.Contains($Old)) {
    return $Content.Replace($Old, $New)
  }
  throw "Patch anchor not found for: $Label"
}

Write-Host '== PATCH JRIDE LIVETRIPSMAP STATUS ONLY V1 (PS5-safe) =='
Write-Host "RepoRoot: $RepoRoot"

$mapPath = Join-Path $RepoRoot 'app\admin\livetrips\components\LiveTripsMap.tsx'
if (!(Test-Path $mapPath)) { throw "Missing file: $mapPath" }

Backup-File -Path $mapPath -Tag 'LIVETRIPSMAP_STATUS_ONLY_V1'
$content = Get-Content -LiteralPath $mapPath -Raw

$old1 = '["pending", "assigned", "on_the_way", "on_trip"].includes(status)'
$new1 = '["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"].includes(status)'
$content = Replace-OrFail -Content $content -Old $old1 -New $new1 -Label 'Map KPI active states'

$old2 = '["pending", "assigned"].includes(status)'
$new2 = '["assigned", "accepted", "fare_proposed", "ready"].includes(status)'
$content = Replace-OrFail -Content $content -Old $old2 -New $new2 -Label 'Map KPI queue states'

$old3 = '["pending", "assigned"].includes((t.status ?? "").toString())'
$new3 = '["assigned", "accepted", "fare_proposed", "ready"].includes((t.status ?? "").toString())'
$content = Replace-OrFail -Content $content -Old $old3 -New $new3 -Label 'Map suggestions trip states'

$old4 = '["idle", "available", "on_the_way", "on_trip"].includes('
$new4 = '["idle", "available", "online", "on_the_way", "on_trip"].includes('
$content = Replace-OrFail -Content $content -Old $old4 -New $new4 -Label 'Map suggestions driver states'

Write-Utf8NoBom -Path $mapPath -Content $content
Write-Host "[OK] Wrote: $mapPath"
Write-Host 'DONE'
