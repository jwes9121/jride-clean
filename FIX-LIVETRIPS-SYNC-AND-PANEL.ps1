# FIX-LIVETRIPS-SYNC-AND-PANEL.ps1
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

$root = Get-Location
$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
$mapPath    = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"

Backup-File $clientPath
Backup-File $mapPath

# -----------------------------
# 1) LiveTripsClient.tsx patch
# -----------------------------
$s = Read-Text $clientPath

# detect setTrips name
$setTrips = $null
$rxSetTrips = [regex]::new("(?m)\b(set[A-Za-z0-9_]*Trips)\s*\(", "None")
$mSet = $rxSetTrips.Match($s)
if ($mSet.Success) { $setTrips = $mSet.Groups[1].Value }
if (-not $setTrips) {
  Write-Host "WARN: Could not detect setTrips; left sync patch will be skipped." -ForegroundColor Yellow
} else {
  # Ensure helper exists
  if ($s -notmatch '\bfunction\s+applyTripStatusToTrips\s*\(') {
    $helper = @"
function applyTripStatusToTrips(prev: any[], bookingCode: string, newStatus: string) {
  const target = String(bookingCode || "").trim();
  if (!target) return prev;

  return (prev || []).map((t: any) => {
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
    # anchor after mapboxgl.accessToken if present, else append near top
    $rxAnchor = [regex]::new("(?m)^\s*mapboxgl\.accessToken\s*=.*?;\s*$")
    $ma = $rxAnchor.Match($s)
    if ($ma.Success) {
      $insertAt = $ma.Index + $ma.Length
      $s = $s.Insert($insertAt, "`r`n`r`n$helper`r`n")
    } else {
      $s = $helper + "`r`n`r`n" + $s
    }
    Write-Host "Inserted applyTripStatusToTrips() helper" -ForegroundColor Green
  } else {
    Write-Host "applyTripStatusToTrips() already exists" -ForegroundColor DarkGray
  }

  # Patch updateTripStatus() by locating function body and inserting after the FIRST await call containing /api/dispatch/status
  $rxFn = [regex]::new("(?s)async\s+function\s+updateTripStatus\s*\(\s*bookingCode\s*:\s*string\s*,\s*status\s*:\s*string\s*\)\s*\{(.*?)\r?\n\}", "None")
  $mf = $rxFn.Match($s)
  if (-not $mf.Success) {
    Write-Host "WARN: Could not find async function updateTripStatus(bookingCode: string, status: string) { ... }" -ForegroundColor Yellow
  } else {
    $body = $mf.Groups[1].Value

    if ($body -match "livetrips:refresh") {
      Write-Host "updateTripStatus already dispatches livetrips:refresh; skipping insertion." -ForegroundColor Yellow
    } else {
      $rxAwaitLine = [regex]::new("(?m)^\s*await\s+.*?/api/dispatch/status.*?;\s*$", "None")
      $mAwait = $rxAwaitLine.Match($body)

      if (-not $mAwait.Success) {
        # handle wrapped fetch lines: any line containing the URL then we insert after the next line containing ');' or ');'
        $rxUrl = [regex]::new("(?m)^\s*.*?/api/dispatch/status.*$", "None")
        $mUrl = $rxUrl.Match($body)
        if (-not $mUrl.Success) {
          throw "Could not find any line containing /api/dispatch/status inside updateTripStatus()."
        }

        # find insertion point after next line that ends a call
        $start = $mUrl.Index + $mUrl.Length
        $tail = $body.Substring($start)
        $rxEnd = [regex]::new("(?m)^\s*\)\s*;\s*$", "None")
        $mEnd = $rxEnd.Match($tail)
        if ($mEnd.Success) {
          $insertPosInBody = $start + $mEnd.Index + $mEnd.Length
        } else {
          # fallback insert immediately after URL line
          $insertPosInBody = $start
        }
      } else {
        $insertPosInBody = $mAwait.Index + $mAwait.Length
      }

      $insertion = @"
`r`n      // --- keep left list in sync immediately ---
      try { $setTrips((prev: any[]) => applyTripStatusToTrips(prev, bookingCode, status)); } catch {}
      try { window.dispatchEvent(new Event("livetrips:refresh")); } catch {}
"@

      $body2 = $body.Insert($insertPosInBody, $insertion)

      # rebuild whole file with patched body
      $s = $s.Substring(0, $mf.Groups[1].Index) + $body2 + $s.Substring($mf.Groups[1].Index + $mf.Groups[1].Length)

      Write-Host "Patched updateTripStatus(): optimistic left update + livetrips:refresh" -ForegroundColor Green
    }
  }
}

Write-Text $clientPath $s
Write-Host "DONE: $clientPath" -ForegroundColor Green

# ---------------------------------------
# 2) LiveTripsMap.tsx panel restore patch
# ---------------------------------------
$m = Read-Text $mapPath

# (A) Ensure selectedTrip resolves via tripKey(t, idx) === selectedTripId
# Replace the whole selectedTrip useMemo block safely by targeting "const selectedTrip = useMemo(() => {"
$rxSelStart = [regex]::new("(?s)const\s+selectedTrip\s*=\s*useMemo\s*\(\s*\(\s*\)\s*=>\s*\{.*?\}\s*,\s*\[.*?\]\s*\)\s*;", "None")
if ($rxSelStart.IsMatch($m)) {
  $replacement = @"
const selectedTrip = useMemo(() => {
  const sid = String(selectedTripId || "").trim();
  if (!sid) return null;
  return (trips || []).find((t: any, idx: number) => tripKey(t, idx) === sid) || null;
}, [trips, selectedTripId]);
"@
  $m = $rxSelStart.Replace($m, $replacement, 1)
  Write-Host "Patched selectedTrip useMemo to match tripKey(t, idx) === selectedTripId" -ForegroundColor Green
} else {
  Write-Host "WARN: Could not locate selectedTrip useMemo block to replace (skipping)." -ForegroundColor Yellow
}

# (B) Ensure DispatchActionPanel is wrapped in a visible scrollable absolute container
if ($m -match "<DispatchActionPanel\b") {
  # If it's already wrapped with our marker, skip
  if ($m -match "data-jride-dispatch-panel-wrapper") {
    Write-Host "DispatchActionPanel wrapper already present" -ForegroundColor DarkGray
  } else {
    # Wrap the first <DispatchActionPanel .../> or <DispatchActionPanel ...>...</DispatchActionPanel>
    $rxPanel = [regex]::new("(?s)(\r?\n\s*)(<DispatchActionPanel\b.*?(?:\/>\s*|<\/DispatchActionPanel>\s*))", "None")
    $wrapOpen = @"
`$1<div data-jride-dispatch-panel-wrapper style={{
  position: "absolute",
  top: 12,
  right: 12,
  zIndex: 60,
  width: 360,
  maxHeight: "calc(100% - 24px)",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  pointerEvents: "auto",
}}>
"@
    $wrapClose = "`r`n</div>`r`n"

    $m2 = $rxPanel.Match($m)
    if ($m2.Success) {
      $m = $rxPanel.Replace($m, ($wrapOpen + "`$2" + $wrapClose), 1)
      Write-Host "Wrapped DispatchActionPanel in visible scrollable absolute container" -ForegroundColor Green
    } else {
      Write-Host "WARN: Found DispatchActionPanel but could not wrap via regex (skipping)." -ForegroundColor Yellow
    }
  }
} else {
  Write-Host "WARN: No <DispatchActionPanel ...> found in LiveTripsMap.tsx (panel may be conditionally rendered elsewhere)." -ForegroundColor Yellow
}

Write-Text $mapPath $m
Write-Host "DONE: $mapPath" -ForegroundColor Green

Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "  1) Stop server (Ctrl+C)" -ForegroundColor Cyan
Write-Host "  2) npm run dev" -ForegroundColor Cyan
