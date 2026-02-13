# FIX-LIVETRIPS-RECOVER.ps1
# - Fixes LiveTripsClient.tsx compile error ("Expected unicode escape")
# - Replaces updateTripStatus() with a robust sync: optimistic update + refresh page-data
# - Ensures DispatchActionPanel wrapper is not clipped (absolute + overflowY auto + zIndex)

$ErrorActionPreference = "Stop"

function Backup-File([string]$path) {
  if (!(Test-Path $path)) { throw "File not found: $path" }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $bak = "$path.bak-$stamp"
  Copy-Item $path $bak -Force
  Write-Host "Backup: $bak" -ForegroundColor Yellow
}

function Find-MatchingBrace([string]$text, [int]$openIndex) {
  # Finds matching '}' for the '{' at openIndex, ignoring braces inside quotes/templates.
  $len = $text.Length
  if ($openIndex -lt 0 -or $openIndex -ge $len) { return -1 }
  if ($text[$openIndex] -ne '{') { return -1 }

  $inS = $false   # single quote
  $inD = $false   # double quote
  $inT = $false   # template `
  $esc = $false
  $depth = 0

  for ($i = $openIndex; $i -lt $len; $i++) {
    $c = [char]$text[$i]

    if ($esc) { $esc = $false; continue }

    # JS escape char inside strings is backslash. Also backtick-template can escape with backslash.
    if (($inS -or $inD -or $inT) -and $c -eq '\') { $esc = $true; continue }

    # Toggle quote states
    if (!$inD -and !$inT -and $c -eq [char]39) { $inS = -not $inS; continue }     # '
    if (!$inS -and !$inT -and $c -eq [char]34) { $inD = -not $inD; continue }     # "
    if (!$inS -and !$inD -and $c -eq [char]96) { $inT = -not $inT; continue }     # `

    if ($inS -or $inD -or $inT) { continue }

    if ($c -eq '{') { $depth++ }
    elseif ($c -eq '}') {
      $depth--
      if ($depth -eq 0) { return $i }
    }
  }
  return -1
}

function Replace-FunctionByName([string]$text, [string]$funcHeaderRegex, [string]$newFuncText) {
  $m = [regex]::Match($text, $funcHeaderRegex, [Text.RegularExpressions.RegexOptions]::Singleline)
  if (!$m.Success) { throw "Could not find function header via regex: $funcHeaderRegex" }

  # find first '{' after match
  $start = $m.Index
  $braceOpen = $text.IndexOf('{', $m.Index + $m.Length)
  if ($braceOpen -lt 0) { throw "Could not find opening brace '{' for function." }

  $braceClose = Find-MatchingBrace $text $braceOpen
  if ($braceClose -lt 0) { throw "Could not find matching closing brace '}' for function." }

  $before = $text.Substring(0, $start)
  $after  = $text.Substring($braceClose + 1)

  return ($before + $newFuncText + $after)
}

# --- Paths ---
$clientPath = "app\admin\livetrips\LiveTripsClient.tsx"
$mapPath    = "app\admin\livetrips\components\LiveTripsMap.tsx"

# --- 1) Fix LiveTripsClient.tsx compile error + robust updateTripStatus ---
Backup-File $clientPath
$s = Get-Content $clientPath -Raw

# Fix the exact bad injected unicode-escape line if present
# Example bad: setLastAction(`OK: status=\ code=\`);
$s2 = $s
$s2 = [regex]::Replace(
  $s2,
  "setLastAction\(\s*`OK:\s*status=\\\s*code=\\\s*`\s*\)\s*;",
  "setLastAction(`OK: status=${status} code=${bookingCode}`);",
  [Text.RegularExpressions.RegexOptions]::Singleline
)

# Also fix any variant with missing vars but containing status=\ code=\
$s2 = [regex]::Replace(
  $s2,
  "setLastAction\(\s*`OK:.*?status=\\\s*code=\\.*?`\s*\)\s*;",
  "setLastAction(`OK: status=${status} code=${bookingCode}`);",
  [Text.RegularExpressions.RegexOptions]::Singleline
)

# Ensure we have postJson helper reference somewhere; we won't assume its signature beyond returning JSON.
# Replace whole updateTripStatus() with a known-good version.
$newUpdateTripStatus = @'
async function updateTripStatus(bookingCode: string, status: string) {
  const code = String(bookingCode || "").trim();
  const toStatus = String(status || "").trim();
  if (!code || !toStatus) return;

  // Optimistic left-table update immediately
  try {
    setTrips((prev: any[]) => (prev || []).map((t: any) => {
      const tCode = String(t?.booking_code || t?.bookingCode || t?.id || "").trim();
      if (tCode && tCode === code) return { ...t, status: toStatus };
      return t;
    }));
  } catch {}

  try {
    const json = await postJson("/api/dispatch/status", { bookingCode: code, status: toStatus, override: true });

    // If API returns a canonical status, use it
    const apiStatus = String((json && (json.toStatus || json.status)) || toStatus).trim() || toStatus;

    try {
      setTrips((prev: any[]) => (prev || []).map((t: any) => {
        const tCode = String(t?.booking_code || t?.bookingCode || t?.id || "").trim();
        const tId   = String(t?.id || t?.uuid || "").trim();
        const apiId = String((json && (json.id || json.uuid)) || "").trim();

        if ((tCode && tCode === code) || (apiId && tId && apiId === tId)) {
          return { ...t, status: apiStatus };
        }
        return t;
      }));
    } catch {}

    // HARD re-sync the page-data after any status change
    try {
      const r = await fetch(`/api/admin/livetrips/page-data?debug=1&t=${Date.now()}`, { cache: "no-store" as any });
      const j = await r.json();
      if (j && Array.isArray(j.trips)) {
        setTrips(j.trips);
      }
    } catch (e) {
      console.warn("refresh page-data failed", e);
    }

    setLastAction(`OK: status=${apiStatus} code=${code}`);
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    setLastAction(`ERROR: ${msg}`);
    throw e;
  }
}
'@

# Replace function block
$funcHeaderRx = "(?m)async\s+function\s+updateTripStatus\s*\(\s*bookingCode:\s*string\s*,\s*status:\s*string\s*\)\s*"
$s3 = $s2
$s3 = Replace-FunctionByName $s3 $funcHeaderRx $newUpdateTripStatus

# Write back
Set-Content -Path $clientPath -Value $s3 -Encoding UTF8
Write-Host "Patched: $clientPath (fixed compile + replaced updateTripStatus)" -ForegroundColor Green


# --- 2) Fix DispatchActionPanel clipping / missing wrapper in LiveTripsMap.tsx ---
if (Test-Path $mapPath) {
  Backup-File $mapPath
  $m = Get-Content $mapPath -Raw

  # If DispatchActionPanel exists but is NOT wrapped, wrap it in a fixed absolute panel container.
  # We handle BOTH <DispatchActionPanel ... /> and <DispatchActionPanel>...</DispatchActionPanel>

  if ($m -match "<DispatchActionPanel\b") {
    # If already has our wrapper marker, skip
    if ($m -notmatch "LIVE_TRIPS_PANEL_WRAPPER") {

      # Self-closing form
      $m = [regex]::Replace(
        $m,
        "(?s)(\s*)(<DispatchActionPanel\b[^>]*\/\s*>)",
        "`$1{/* LIVE_TRIPS_PANEL_WRAPPER */}`r`n`$1<div style={{ position: 'absolute', top: 12, right: 12, bottom: 12, width: 360, maxWidth: '92vw', overflowY: 'auto', zIndex: 50, pointerEvents: 'auto' }}>`r`n`$1  `$2`r`n`$1</div>",
        1
      )

      # Non-self-closing form
      $m = [regex]::Replace(
        $m,
        "(?s)(\s*)(<DispatchActionPanel\b[^>]*>.*?<\/DispatchActionPanel\s*>)",
        "`$1{/* LIVE_TRIPS_PANEL_WRAPPER */}`r`n`$1<div style={{ position: 'absolute', top: 12, right: 12, bottom: 12, width: 360, maxWidth: '92vw', overflowY: 'auto', zIndex: 50, pointerEvents: 'auto' }}>`r`n`$1  `$2`r`n`$1</div>",
        1
      )

      Set-Content -Path $mapPath -Value $m -Encoding UTF8
      Write-Host "Patched: $mapPath (wrapped DispatchActionPanel to prevent clipping)" -ForegroundColor Green
    } else {
      Write-Host "DispatchActionPanel wrapper already present; skipping map patch." -ForegroundColor DarkYellow
    }
  } else {
    Write-Host "No DispatchActionPanel found in LiveTripsMap.tsx; skipping map patch." -ForegroundColor DarkYellow
  }
} else {
  Write-Host "LiveTripsMap.tsx not found at $mapPath; skipping map patch." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "DONE. Now restart dev server:" -ForegroundColor Cyan
Write-Host "  (stop running npm dev, then) npm run dev" -ForegroundColor Cyan
