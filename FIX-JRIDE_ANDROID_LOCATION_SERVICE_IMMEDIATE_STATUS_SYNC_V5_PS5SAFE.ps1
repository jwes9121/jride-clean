param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  $dir = Split-Path -Parent $Path
  $name = Split-Path -Leaf $Path
  $bakDir = Join-Path $dir "_patch_bak"
  if (-not (Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ($name + ".bak." + $Tag + "." + $stamp)
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

$resolvedRoot = (Resolve-Path $ProjRoot).Path
$matches = Get-ChildItem -Path $resolvedRoot -Recurse -Filter "LocationUpdateService.kt" -File | Select-Object -ExpandProperty FullName

if (-not $matches -or $matches.Count -eq 0) {
  throw "LocationUpdateService.kt not found under: $resolvedRoot"
}

if ($matches.Count -gt 1) {
  Write-Host "[INFO] Multiple LocationUpdateService.kt files found:"
  $matches | ForEach-Object { Write-Host " - $_" }
}

$target = $matches[0]
Write-Host "[OK] Target file:"
Write-Host "     $target"

Backup-File -Path $target -Tag "IMMEDIATE_STATUS_SYNC_V5"

$content = [System.IO.File]::ReadAllText($target)
$original = $content

$startNeedle = @'
                persistToPrefs()

                startForeground(
'@

$startReplace = @'
                persistToPrefs()

                LiveLocationClient.sendStatusAsync(
                    driverId = driverId,
                    status = status,
                    town = town,
                    deviceId = deviceId,
                    onDone = { ok, _, code ->
                        Log.i(TAG, "Immediate status sync on start: ok=" + ok + " code=" + code + " status=" + status)
                    }
                )

                startForeground(
'@

if ($content.Contains($startNeedle)) {
  $content = $content.Replace($startNeedle, $startReplace)
} elseif ($content.Contains('Immediate status sync on start')) {
  Write-Host "[OK] ACTION_START immediate status sync already present."
} else {
  throw "Could not find ACTION_START persistToPrefs() block in $target"
}

$stopNeedle = @'
                stopActiveTripPolling()
                stopUpdates()
                status = "offline"
                persistToPrefs()
                stopForeground(true)
                stopSelf()
'@

$stopReplace = @'
                stopActiveTripPolling()
                stopUpdates()
                status = "offline"
                persistToPrefs()

                LiveLocationClient.sendStatusAsync(
                    driverId = driverId,
                    status = "offline",
                    town = town,
                    deviceId = deviceId,
                    onDone = { ok, _, code ->
                        Log.i(TAG, "Immediate status sync on stop: ok=" + ok + " code=" + code)
                    }
                )

                stopForeground(true)
                stopSelf()
'@

if ($content.Contains($stopNeedle)) {
  $content = $content.Replace($stopNeedle, $stopReplace)
} elseif ($content.Contains('Immediate status sync on stop')) {
  Write-Host "[OK] ACTION_STOP immediate status sync already present."
} else {
  throw "Could not find ACTION_STOP block in $target"
}

$restoreNeedle = @'
                if (status == "online" || status == "walkin") {
                    startForeground(
                        NOTIF_ID,
                        buildNotification(if (status == "online") "Online - Waiting for booking..." else "Walk-in active")
                    )
                    startUpdates()
                    if (status == "online") startActiveTripPolling()
                }
'@

$restoreReplace = @'
                if (status == "online" || status == "walkin") {
                    startForeground(
                        NOTIF_ID,
                        buildNotification(if (status == "online") "Online - Waiting for booking..." else "Walk-in active")
                    )

                    LiveLocationClient.sendStatusAsync(
                        driverId = driverId,
                        status = status,
                        town = town,
                        deviceId = deviceId,
                        onDone = { ok, _, code ->
                            Log.i(TAG, "Immediate status sync on restore: ok=" + ok + " code=" + code + " status=" + status)
                        }
                    )

                    startUpdates()
                    if (status == "online") startActiveTripPolling()
                }
'@

if ($content.Contains($restoreNeedle)) {
  $content = $content.Replace($restoreNeedle, $restoreReplace)
} elseif ($content.Contains('Immediate status sync on restore')) {
  Write-Host "[OK] restoreFromPrefs immediate status sync already present."
} else {
  throw "Could not find restoreFromPrefs online/walkin block in $target"
}

if ($content -eq $original) {
  throw "No changes were applied"
}

Write-Utf8NoBom -Path $target -Content $content

Write-Host "[OK] Patched:"
Write-Host "     $target"