param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

Write-Host "== PATCH JRIDE LIVETRIPSMAP STATUS ONLY V3 (PS5-safe) =="
Write-Host "RepoRoot: $RepoRoot"

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
  $bakDir = Join-Path $RepoRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ((Split-Path $Path -Leaf) + ".bak." + $Tag + "." + $stamp)
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$mapPath = Join-Path $RepoRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $mapPath)) {
  throw "File not found: $mapPath"
}

Backup-File -Path $mapPath -Tag "LIVETRIPSMAP_STATUS_ONLY_V3"

$content = Get-Content -LiteralPath $mapPath -Raw
$original = $content

$old1 = '["pending", "assigned", "on_the_way", "on_trip"].includes(status)'
$new1 = '["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"].includes(status)'
if ($content.Contains($old1)) {
  $content = $content.Replace($old1, $new1)
  Write-Host "[OK] Patched active states"
} else {
  throw "Patch anchor not found for: Map KPI active states`nExpected exact text: $old1"
}

$old2 = '["pending", "assigned"].includes(status)'
$new2 = '["assigned", "accepted", "fare_proposed", "ready"].includes(status)'
if ($content.Contains($old2)) {
  $content = $content.Replace($old2, $new2)
  Write-Host "[OK] Patched pending/queue KPI states"
} else {
  throw "Patch anchor not found for: Map KPI queue states`nExpected exact text: $old2"
}

$old3 = '["pending", "assigned"].includes((t.status ?? "").toString())'
$new3 = '["assigned", "accepted", "fare_proposed", "ready"].includes((t.status ?? "").toString())'
if ($content.Contains($old3)) {
  $content = $content.Replace($old3, $new3)
  Write-Host "[OK] Patched suggestions source trip states"
} else {
  throw "Patch anchor not found for: Suggestions trip states`nExpected exact text: $old3"
}

$old4 = '["idle", "available", "on_the_way", "on_trip"].includes('
$new4 = '["idle", "available", "online", "on_the_way", "on_trip"].includes('
if ($content.Contains($old4)) {
  $content = $content.Replace($old4, $new4)
  Write-Host "[OK] Patched driver pool states"
} else {
  throw "Patch anchor not found for: Driver pool states`nExpected exact text: $old4"
}

if ($content -eq $original) {
  throw "No changes were applied to LiveTripsMap.tsx"
}

Write-Utf8NoBom -Path $mapPath -Content $content
Write-Host "[OK] Wrote: $mapPath"
Write-Host "Done."
