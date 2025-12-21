# FIX-LIVETRIPS-LEFTSYNC.ps1
# Ensures left table updates immediately after status change:
#  - optimistic state update (match by booking_code/bookingCode/id/uuid)
#  - dispatch livetrips:refresh event
$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (-not (Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd-HHmmss"
  $bak = "$path.bak-$ts"
  Copy-Item $path $bak -Force
  Write-Host "Backup: $bak" -ForegroundColor DarkGray
}

function Read-Text($path) { Get-Content -Raw -Encoding UTF8 $path }
function Write-Text($path, $text) {
  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Find-SetterName([string]$text, [string]$suffix) {
  $rx = [regex]::new("(?m)\b(set[A-Za-z0-9_]*$suffix)\s*\(", [System.Text.RegularExpressions.RegexOptions]::None)
  $m = $rx.Match($text)
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

$root = Get-Location
$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
Backup-File $clientPath

$s = Read-Text $clientPath

$setTrips = Find-SetterName $s "Trips"
if (-not $setTrips) {
  throw "Could not detect trips state setter (set*Trips). Paste the top part of LiveTripsClient.tsx where state is declared."
}

# 1) Make sure we have an apply helper (safe + id/uuid/code matching)
if ($s -notmatch '\bfunction\s+applyTripStatusToTrips\s*\(') {
  $helper = @"
function applyTripStatusToTrips(prev: any[], bookingCode: string, newStatus: string) {
  const target = String(bookingCode || "").trim();
  if (!target) return prev;

  return (prev || []).map((t: any, idx: number) => {
    const code = String(t?.booking_code ?? t?.bookingCode ?? "").trim();
    const id = String(t?.id ?? "").trim();
    const uuid = String(t?.uuid ?? "").trim();

    const match =
      (code && code === target) ||
      (id && id === target) ||
      (uuid && uuid === target);

    if (!match) return t;
    return { ...t, status: newStatus };
  });
}
"@

  # Insert helper near top: after mapbox token line (common stable anchor)
  $anchorRx = [regex]::new('(?m)^\s*mapboxgl\.accessToken\s*=.*?;\s*$')
  $m = $anchorRx.Match($s)
  if (-not $m.Success) { throw "Could not find mapboxgl.accessToken line to anchor helper insertion." }

  $insertAt = $m.Index + $m.Length
  $s = $s.Insert($insertAt, "`r`n`r`n$helper`r`n")
  Write-Host "Inserted applyTripStatusToTrips() helper" -ForegroundColor Green
} else {
  Write-Host "applyTripStatusToTrips() already exists" -ForegroundColor DarkGray
}

# 2) Patch updateTripStatus: after await postJson("/api/dispatch/status"...), do optimistic update + dispatch refresh
$rxCall = [regex]::new('(?m)^\s*await\s+postJson\(\s*["'']/api/dispatch/status["'']\s*,\s*\{\s*bookingCode\s*,\s*status\s*(,\s*override\s*:\s*true\s*)?\}\s*\)\s*;\s*$')
$m2 = $rxCall.Match($s)
if (-not $m2.Success) {
  throw "Could not find line: await postJson(""/api/dispatch/status"", { bookingCode, status ... }); in LiveTripsClient.tsx"
}

$insertion = @"
      // --- keep left list in sync immediately ---
      try {
        $setTrips((prev: any[]) => applyTripStatusToTrips(prev, bookingCode, status));
      } catch {}
      try {
        window.dispatchEvent(new Event("livetrips:refresh"));
      } catch {}
"@

# Avoid double-inserting
if ($s.Substring($m2.Index, [Math]::Min(400, $s.Length - $m2.Index)) -match 'livetrips:refresh') {
  Write-Host "updateTripStatus already dispatches livetrips:refresh; skipping insert." -ForegroundColor Yellow
} else {
  $pos = $m2.Index + $m2.Length
  $s = $s.Insert($pos, "`r`n$insertion")
  Write-Host "Patched updateTripStatus(): optimistic left update + livetrips:refresh" -ForegroundColor Green
}

Write-Text $clientPath $s
Write-Host "DONE: $clientPath" -ForegroundColor Green

Write-Host ""
Write-Host "Restart dev server:" -ForegroundColor Cyan
Write-Host "  Ctrl+C then  npm run dev" -ForegroundColor Cyan
