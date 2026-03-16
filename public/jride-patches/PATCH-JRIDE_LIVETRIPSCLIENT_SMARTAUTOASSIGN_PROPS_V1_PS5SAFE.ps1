# ============================================================
# PATCH-JRIDE_LIVETRIPSCLIENT_SMARTAUTOASSIGN_PROPS_V1_PS5SAFE
# ============================================================
# Purpose:
#   Fix SmartAutoAssignSuggestions props in
#   app/admin/livetrips/LiveTripsClient.tsx
#
# Error fixed:
#   Type '{ trip: any; drivers: any; }' is missing:
#   zoneStats, onAssign
#
# Scope:
#   app/admin/livetrips/LiveTripsClient.tsx
#
# Safety:
#   - PowerShell 5 safe
#   - UTF-8 without BOM
#   - Timestamped backup
#   - Loud abort on missing anchor
#   - Idempotent
# ============================================================

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Fail([string]$Message) {
    throw $Message
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Backup-File([string]$SourcePath, [string]$BackupDir) {
    $leaf = Split-Path -Leaf $SourcePath
    $dest = Join-Path $BackupDir ($leaf + ".bak")
    Copy-Item -Path $SourcePath -Destination $dest -Force
    return $dest
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$target = Join-Path $repoRoot "app\admin\livetrips\LiveTripsClient.tsx"

if (-not (Test-Path -LiteralPath $target)) {
    Fail "ABORT: target file not found: $target"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $repoRoot ("_backups\livetripsclient-smartassign-" + $timestamp)
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$backup = Backup-File -SourcePath $target -BackupDir $backupDir

$content = [System.IO.File]::ReadAllText($target, [System.Text.Encoding]::UTF8)

$old = @'
                <SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} />
'@

$new = @'
                <SmartAutoAssignSuggestions
                  trip={selectedTrip as any}
                  drivers={drivers as any}
                  zoneStats={zones as any}
                  onAssign={async (driverId: string) => {
                    if (!selectedTrip?.booking_code || !driverId) return;
                    await assignDriver(selectedTrip.booking_code, driverId);
                  }}
                />
'@

if ($content.Contains($new)) {
    Write-Host ""
    Write-Host "PATCH COMPLETE" -ForegroundColor Green
    Write-Host "SmartAutoAssignSuggestions props already patched." -ForegroundColor White
    Write-Host ("Backup: " + $backup) -ForegroundColor White
    Write-Host ""
    Write-Host "NEXT:" -ForegroundColor Yellow
    Write-Host "npm run build" -ForegroundColor White
    exit 0
}

if (-not $content.Contains($old)) {
    Fail "ABORT: exact SmartAutoAssignSuggestions anchor not found in LiveTripsClient.tsx"
}

$content = $content.Replace($old, $new)

if (-not $content.Contains('zoneStats={zones as any}')) {
    Fail "ABORT: zoneStats prop not found after patch"
}
if (-not $content.Contains('onAssign={async (driverId: string) => {')) {
    Fail "ABORT: onAssign prop not found after patch"
}

Write-Utf8NoBom -Path $target -Content $content

Write-Host ""
Write-Host "PATCH COMPLETE" -ForegroundColor Green
Write-Host ("Backup: " + $backup) -ForegroundColor White
Write-Host "SmartAutoAssignSuggestions now receives zoneStats and onAssign." -ForegroundColor White
Write-Host ""
Write-Host "NEXT:" -ForegroundColor Yellow
Write-Host "npm run build" -ForegroundColor White
Write-Host "git add app/admin/livetrips/LiveTripsClient.tsx public/jride-patches/PATCH-JRIDE_LIVETRIPSCLIENT_SMARTAUTOASSIGN_PROPS_V1_PS5SAFE.ps1" -ForegroundColor White
Write-Host 'git commit -m "fix LiveTrips SmartAutoAssignSuggestions props"' -ForegroundColor White
Write-Host "git push" -ForegroundColor White