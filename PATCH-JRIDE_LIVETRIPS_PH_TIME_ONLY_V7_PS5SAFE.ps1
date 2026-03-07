param(
  [Parameter(Mandatory = $true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host $msg -ForegroundColor Green }
function Write-WarnMsg($msg) { Write-Host $msg -ForegroundColor Yellow }

function Backup-File([string]$path, [string]$tag) {
  $dir = Split-Path -Parent $path
  $name = Split-Path -Leaf $path
  $bakDir = Join-Path $dir "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ($name + ".bak." + $tag + "." + $stamp)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Ok ("Backup: " + $bak)
}

function Read-Utf8NoBom([string]$path) {
  return [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
}

function Write-Utf8NoBom([string]$path, [string]$content) {
  $enc = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

function Ensure-LineAfterTypeField([string]$content, [string]$fieldLine, [string]$lineToAdd) {
  if ($content.Contains($lineToAdd.Trim())) { return $content }
  $idx = $content.IndexOf($fieldLine, [System.StringComparison]::Ordinal)
  if ($idx -lt 0) { return $content }
  $pos = $idx + $fieldLine.Length
  return $content.Substring(0, $pos) + "`r`n" + $lineToAdd + $content.Substring($pos)
}

function Replace-Once([string]$content, [string]$oldText, [string]$newText) {
  if ($content.Contains($newText)) { return $content }
  $idx = $content.IndexOf($oldText, [System.StringComparison]::Ordinal)
  if ($idx -lt 0) { return $content }
  return $content.Substring(0, $idx) + $newText + $content.Substring($idx + $oldText.Length)
}

Write-Info "== JRIDE Patch: LiveTrips PH time only (V7 / PS5-safe) =="
Write-Info ("Root: " + $ProjRoot)

if (!(Test-Path -LiteralPath $ProjRoot)) {
  throw "ProjRoot does not exist: $ProjRoot"
}

$liveTripsPath = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path -LiteralPath $liveTripsPath)) {
  throw "Missing expected LiveTrips source file: $liveTripsPath"
}

Write-Ok ("LiveTrips source file: " + $liveTripsPath)

Backup-File -path $liveTripsPath -tag "PH_TZ_LIVETRIPS_V7"

$live = Read-Utf8NoBom $liveTripsPath

$helperMarker = "JRIDE_PH_TIME_FORMATTER_V7"
$helperBlock = @'
/* JRIDE_PH_TIME_FORMATTER_V7 */
function formatPHTime(input?: string | null): string {
  if (!input) return "-";
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) return String(input);
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
'@

if (-not $live.Contains($helperMarker)) {
  $anchor1 = "function minutesSince("
  $anchor2 = "export default function LiveTripsClient"
  $idx1 = $live.IndexOf($anchor1, [System.StringComparison]::Ordinal)
  $idx2 = $live.IndexOf($anchor2, [System.StringComparison]::Ordinal)

  if ($idx1 -ge 0) {
    $live = $live.Substring(0, $idx1) + $helperBlock + "`r`n`r`n" + $live.Substring($idx1)
    Write-Ok "Inserted PH formatter before minutesSince()."
  }
  elseif ($idx2 -ge 0) {
    $live = $live.Substring(0, $idx2) + $helperBlock + "`r`n`r`n" + $live.Substring($idx2)
    Write-Ok "Inserted PH formatter before LiveTripsClient export."
  }
  else {
    throw "Could not find insertion anchor in LiveTripsClient.tsx"
  }
} else {
  Write-WarnMsg "PH formatter already present."
}

$live = Ensure-LineAfterTypeField -content $live -fieldLine "  updated_at?: string | null;" -lineToAdd "  updated_at_ph?: string | null;"
$live = Ensure-LineAfterTypeField -content $live -fieldLine "  created_at?: string | null;" -lineToAdd "  created_at_ph?: string | null;"

$oldDebug1 = @'
          setDrivers(arr);
          setDriversDebug(`loaded from ${url} (${arr.length})`);
          return;
'@

$newDebug1 = @'
          setDrivers(arr);
          const firstAny: any = arr[0] || null;
          const firstStamp = firstAny?.updated_at_ph || formatPHTime(firstAny?.updated_at || null);
          setDriversDebug(`loaded from ${url} (${arr.length}) | first_driver_updated_at_ph=${firstStamp}`);
          return;
'@

$oldDebug2 = @'
          setDrivers(arr);
          setDriversDebug(`loaded: ${arr.length}`);
'@

$newDebug2 = @'
          setDrivers(arr);
          const firstAny: any = arr[0] || null;
          const firstStamp = firstAny?.updated_at_ph || formatPHTime(firstAny?.updated_at || null);
          setDriversDebug(`loaded: ${arr.length} | first_driver_updated_at_ph=${firstStamp}`);
'@

if ($live.Contains("first_driver_updated_at_ph=")) {
  Write-WarnMsg "DriversDebug already patched."
} else {
  $before = $live
  $live = Replace-Once -content $live -oldText $oldDebug1 -newText $newDebug1
  if ($live -eq $before) {
    $live = Replace-Once -content $live -oldText $oldDebug2 -newText $newDebug2
  }

  if ($live -ne $before) {
    Write-Ok "Patched DriversDebug string."
  } else {
    Write-WarnMsg "Could not find exact DriversDebug block; helper/type fields still applied."
  }
}

Write-Utf8NoBom -path $liveTripsPath -content $live
Write-Ok "Patched LiveTripsClient.tsx."

Write-Host ""
Write-Ok "PATCH COMPLETE"
Write-Host ("LiveTrips patched: " + $liveTripsPath)
Write-Host ""
Write-Host "Expected result after build/deploy:"
Write-Host " - /api/admin/driver_locations?debug=1 returns updated_at_ph and server_now_ph"
Write-Host " - /admin/livetrips may show first_driver_updated_at_ph in DriversDebug if the exact block matched"