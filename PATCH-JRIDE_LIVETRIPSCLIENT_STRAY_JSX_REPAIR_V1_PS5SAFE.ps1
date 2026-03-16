param(
  [string]$RepoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host $m -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }
function Write-Fail([string]$m) { Write-Host $m -ForegroundColor Red }

function Read-Utf8NoBom([string]$Path) {
  return [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function New-Backup([string]$FilePath, [string]$BackupDir) {
  if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  }
  $name = [System.IO.Path]::GetFileName($FilePath)
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $dest = Join-Path $BackupDir ($name + "." + $ts + ".bak")
  Copy-Item $FilePath $dest -Force
  return $dest
}

Write-Info "== PATCH JRIDE LIVETRIPSCLIENT STRAY JSX REPAIR V1 (PS5-safe) =="
Write-Info "RepoRoot: $RepoRoot"

$clientFile = Join-Path $RepoRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path $clientFile)) {
  Write-Fail "FATAL: LiveTripsClient.tsx not found: $clientFile"
  exit 1
}

$backupDir = Join-Path $RepoRoot "_backups\livetrips-client-repair"
$backup = New-Backup -FilePath $clientFile -BackupDir $backupDir
Write-Ok "Backup created: $backup"

$content = Read-Utf8NoBom $clientFile
if ([string]::IsNullOrWhiteSpace($content)) {
  Write-Fail "FATAL: LiveTripsClient.tsx is empty."
  exit 1
}

# ------------------------------------------------------------------
# 1) Remove raw stray JSX summary tiles injected into code sections.
#    These are the compile breakers seen near the polling block.
# ------------------------------------------------------------------
$patterns = @(
  '(?s)^\s*<div className="p-2 border rounded">\s*Eligible:\s*\{drivers\.filter\(d => d\.assign_eligible\)\.length\}\s*</div>\s*<div className="p-2 border rounded">\s*Stale:\s*\{drivers\.filter\(d => d\.is_stale\)\.length\}\s*</div>\s*<div className="p-2 border rounded">\s*Online:\s*\{drivers\.filter\(d => !d\.is_stale\)\.length\}\s*</div>\s*<div className="p-2 border rounded">\s*Trips:\s*\{trips\.length\}\s*</div>\s*<div className="p-2 border rounded">\s*Unassigned:\s*\{trips\.filter\(t => !t\.driver_id\)\.length\}\s*</div>\s*'
  '(?s)\{\s*/\*\s*SUPPLY SUMMARY\s*\*/\s*\}\s*<div className="mb-4 grid grid-cols-5 gap-2 text-sm">.*?</div>\s*'
)

$original = $content
foreach ($p in $patterns) {
  $content = [regex]::Replace($content, $p, '', 'Multiline')
}

if ($content -ne $original) {
  Write-Ok "Removed stray injected JSX summary blocks"
} else {
  Write-Warn "WARNING: No known stray JSX summary blocks matched. Continuing."
}

# ------------------------------------------------------------------
# 2) Ensure LiveTripsMap receives drivers prop.
#    This uses a tolerant regex over the JSX tag.
# ------------------------------------------------------------------
if ($content -match 'drivers=\{drivers as any\}' -or $content -match 'drivers=\{drivers\}') {
  Write-Warn "WARNING: LiveTripsMap already appears to have drivers prop."
} else {
  $mapPattern = '(?s)<LiveTripsMap\b(.*?trips=\{mapTrips as any\}.*?selectedTripId=\{selectedTripId\}.*?stuckTripIds=\{stuckTripIds as any\}.*?)\/>'
  $mapReplacement = '<LiveTripsMap$1 drivers={drivers as any} />'
  $content2 = [regex]::Replace($content, $mapPattern, $mapReplacement, 1)

  if ($content2 -eq $content) {
    Write-Warn "WARNING: Could not inject drivers prop into LiveTripsMap automatically."
  } else {
    $content = $content2
    Write-Ok "Injected drivers prop into LiveTripsMap"
  }
}

# ------------------------------------------------------------------
# 3) Validation: there must be no raw <div className="p-2 border rounded">
#    blocks before the component return.
# ------------------------------------------------------------------
$returnIndex = $content.IndexOf("return (")
if ($returnIndex -lt 0) {
  Write-Fail "FATAL: Could not find component return ( anchor."
  exit 1
}

$preReturn = $content.Substring(0, $returnIndex)
if ($preReturn -match '<div className="p-2 border rounded">') {
  Write-Fail 'FATAL: Stray summary JSX still exists before the component return.'
  exit 1
}

Write-Utf8NoBom $clientFile $content
Write-Ok "Patched LiveTripsClient.tsx"

Write-Host ""
Write-Ok "============================================================"
Write-Ok "PATCH COMPLETE"
Write-Ok "Client : $clientFile"
Write-Ok "Backup : $backup"
Write-Ok "============================================================"
Write-Host ""

Write-Info "NEXT:"
Write-Host "1) cd `"$RepoRoot`""
Write-Host "2) npm run build"