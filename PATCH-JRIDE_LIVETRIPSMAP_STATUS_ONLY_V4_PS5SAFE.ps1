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
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $ts = Get-Date -Format 'yyyyMMdd_HHmmss'
  $bak = Join-Path $bakDir ((Split-Path $Path -Leaf) + '.bak.' + $Tag + '.' + $ts)
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

Write-Host '== PATCH JRIDE LIVETRIPSMAP STATUS ONLY V4 (PS5-safe) =='
Write-Host "RepoRoot: $RepoRoot"

$mapPath = Join-Path $RepoRoot 'app\admin\livetrips\components\LiveTripsMap.tsx'
if (!(Test-Path $mapPath)) {
  throw "Missing file: $mapPath"
}

Backup-File -Path $mapPath -Tag 'LIVETRIPSMAP_STATUS_ONLY_V4'
$content = Get-Content -LiteralPath $mapPath -Raw
$original = $content

$foundOldActive = $content.Contains('["pending", "assigned", "on_the_way", "on_trip"].includes(status)')
$foundOldQueue1 = $content.Contains('["pending", "assigned"].includes(status)')
$foundOldQueue2 = $content.Contains('["pending", "assigned"].includes((t.status ?? "").toString())')
$foundDriverPool = $content.Contains('["idle", "available", "on_the_way", "on_trip"].includes(')

if (-not $foundOldActive -and -not $foundOldQueue1 -and -not $foundOldQueue2 -and -not $foundDriverPool) {
  Write-Host '[INFO] No legacy status-anchor strings exist in this LiveTripsMap.tsx.'
  Write-Host '[INFO] This file does not contain the old pending/assigned/on_the_way/on_trip filter blocks that prior patches targeted.'
  Write-Host '[INFO] No changes written. Previous failures were caused by incorrect assumptions about file contents.'
  exit 0
}

if ($foundOldActive) {
  $content = $content.Replace('["pending", "assigned", "on_the_way", "on_trip"].includes(status)', '["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"].includes(status)')
}
if ($foundOldQueue1) {
  $content = $content.Replace('["pending", "assigned"].includes(status)', '["assigned", "accepted", "fare_proposed", "ready"].includes(status)')
}
if ($foundOldQueue2) {
  $content = $content.Replace('["pending", "assigned"].includes((t.status ?? "").toString())', '["assigned", "accepted", "fare_proposed", "ready"].includes((t.status ?? "").toString())')
}
if ($foundDriverPool) {
  $content = $content.Replace('["idle", "available", "on_the_way", "on_trip"].includes(', '["idle", "available", "online", "on_the_way", "on_trip"].includes(')
}

if ($content -eq $original) {
  Write-Host '[INFO] No text changes were required.'
  exit 0
}

Write-Utf8NoBom -Path $mapPath -Content $content
Write-Host "[OK] Wrote: $mapPath"
