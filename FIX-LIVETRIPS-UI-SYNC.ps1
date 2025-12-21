$ErrorActionPreference = "Stop"

function Backup-File([string]$path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd-HHmmss"
  $bak = "$path.bak-$ts"
  Copy-Item $path $bak -Force
  Write-Host "Backup: $bak" -ForegroundColor Yellow
}

function Read-Text([string]$path) { Get-Content -Raw -LiteralPath $path }
function Write-Text([string]$path, [string]$text) { Set-Content -LiteralPath $path -Value $text -Encoding UTF8 }

$root = (Get-Location).Path
$clientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
$mapPath    = Join-Path $root "app\admin\livetrips\components\LiveTripsMap.tsx"

Backup-File $clientPath
Backup-File $mapPath

# --------------------------
# Patch LiveTripsMap.tsx
# --------------------------
$m = Read-Text $mapPath

# 1) Force selectedTrip to resolve by booking_code/id/uuid vs selectedTripId
$rxSelStart = [regex]::new("(?s)const\s+selectedTrip\s*=\s*useMemo\(\(\)\s*=>\s*\{", "Singleline")
$rxSelEnd   = [regex]::new("(?s)\}\s*,\s*\[\s*trips\s*,\s*selectedTripId\s*\]\s*\);\s*", "Singleline")

if ($rxSelStart.IsMatch($m) -and $rxSelEnd.IsMatch($m)) {
  $start = $rxSelStart.Match($m).Index
  $endm  = $rxSelEnd.Match($m, $start)
  if (!$endm.Success) { throw "Could not locate end of selectedTrip useMemo." }

  $end = $endm.Index + $endm.Length

  $newBlock = @"
const selectedTrip = useMemo(() => {
  const sid = String(selectedTripId || "").trim();
  if (!sid) return null;

  const keyOf = (t: any) =>
    String(t.booking_code ?? t.bookingCode ?? t.uuid ?? t.id ?? "").trim();

  return (trips || []).find((t: any) => keyOf(t) === sid) ?? null;
}, [trips, selectedTripId]);

"@

  $m = $m.Substring(0, $start) + $newBlock + $m.Substring($end)
  Write-Host "Patched LiveTripsMap.tsx: selectedTrip resolver fixed." -ForegroundColor Green
} else {
  Write-Host "WARN: selectedTrip useMemo not found (pattern mismatch)." -ForegroundColor Yellow
}

# 2) Make the panel wrapper scrollable by ensuring overflowY is auto on the wrapper style object
# We do a simple targeted injection near existing overflowX/overscrollBehavior if present.
if ($m -match 'overflowX:\s*"hidden"') {
  if ($m -notmatch 'overflowY:\s*"auto"') {
    $m = $m -replace 'overflowX:\s*"hidden"\s*,', 'overflowX: "hidden",`r`n            overflowY: "auto",'
    Write-Host "Patched LiveTripsMap.tsx: panel wrapper overflowY added." -ForegroundColor Green
  } else {
    Write-Host "LiveTripsMap.tsx already has overflowY:auto." -ForegroundColor DarkGray
  }
} else {
  Write-Host "WARN: Could not find overflowX:hidden anchor for scroll patch." -ForegroundColor Yellow
}

Write-Text $mapPath $m

# --------------------------
# Patch LiveTripsClient.tsx
# --------------------------
$c = Read-Text $clientPath

# Detect setTrips var name
$setTripsVar = "setTrips"
$mm = [regex]::Match($c, '(?s)\[\s*trips\s*,\s*(\w+)\s*\]\s*=\s*useState')
if ($mm.Success) { $setTripsVar = $mm.Groups[1].Value }

# Replace ONLY the body of updateTripStatus by anchoring the function header and the first closing brace on column 0.
# We require "async function updateTripStatus(" to exist.
$rxFn = [regex]::new("(?s)async\s+function\s+updateTripStatus\s*\(\s*bookingCode\s*:\s*string\s*,\s*status\s*:\s*string\s*\)\s*\{.*?\n\}", "Singleline")
if (!$rxFn.IsMatch($c)) { throw "Could not find updateTripStatus(bookingCode: string, status: string) function." }

$newFn = @"
async function updateTripStatus(bookingCode: string, status: string) {
  try {
    const json = await postJson("/api/dispatch/status", { bookingCode, status });

    const toStatus = String((json && (json.status || json.toStatus)) || status).trim();
    const apiCode = String((json && (json.booking_code || json.bookingCode || json.booking_code)) || bookingCode || "").trim();
    const apiId   = String((json && (json.id || json.uuid)) || "").trim();

    // Optimistic UI update so LEFT table updates instantly
    try {
      if (typeof $setTripsVar === "function") {
        $setTripsVar((prev: any[]) => {
          const arr = Array.isArray(prev) ? prev : [];
          return arr.map((t: any) => {
            const tCode = String(t.booking_code ?? t.bookingCode ?? "").trim();
            const tId   = String(t.id ?? t.uuid ?? "").trim();

            const match =
              (apiCode && tCode && tCode === apiCode) ||
              (bookingCode && tCode && tCode === String(bookingCode).trim()) ||
              (apiId && tId && tId === apiId);

            if (!match) return t;

            return { ...t, status: toStatus };
          });
        });
      }
    } catch {}

    try {
      setLastAction(\`OK: status=\${toStatus} code=\${apiCode || bookingCode}\`);
    } catch {}
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    try { setLastAction(msg); } catch {}
    throw e;
  }
}
"@

$c = $rxFn.Replace($c, $newFn, 1)
Write-Text $clientPath $c
Write-Host "Patched LiveTripsClient.tsx: updateTripStatus now updates LEFT instantly." -ForegroundColor Green

Write-Host ""
Write-Host "DONE. Restart dev server:" -ForegroundColor Cyan
Write-Host "  Ctrl+C, then: npm run dev" -ForegroundColor Cyan
