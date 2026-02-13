# FIX-LIVETRIPS-FUNCTIONALITY.ps1
# - Restores LiveTrips functionality WITHOUT restore-point hunting
# - Fixes: right Dispatch panel visibility, instant left sync, logical button enable/disable
# - Creates .bak backups before editing

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Backup-File([string]$path) {
  if (Test-Path $path) {
    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $bak = "$path.bak-$ts"
    Copy-Item $path $bak -Force
    Write-Host "Backup: $bak" -ForegroundColor DarkGray
  }
}

function Read-Text([string]$path) {
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Write-Text([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, [System.Text.Encoding]::UTF8)
}

function Ensure-InsertedOnce([string]$s, [string]$needle, [string]$insertAfter, [string]$block) {
  if ($s.Contains($needle)) { return $s }
  $idx = $s.IndexOf($insertAfter)
  if ($idx -lt 0) { throw "Anchor not found: $insertAfter" }
  $pos = $idx + $insertAfter.Length
  return $s.Substring(0, $pos) + $block + $s.Substring($pos)
}

function Replace-Once([string]$s, [string]$find, [string]$replace) {
  $idx = $s.IndexOf($find)
  if ($idx -lt 0) { throw "Could not find exact text to replace: $find" }
  return $s.Substring(0, $idx) + $replace + $s.Substring($idx + $find.Length)
}

function Try-RegexReplace([string]$s, [string]$pattern, [string]$replace, [string]$desc) {
  $rx = [regex]::new($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $rx.IsMatch($s)) {
    Write-Host "WARN: Pattern not found for $desc. Skipping." -ForegroundColor Yellow
    return $s
  }
  return $rx.Replace($s, $replace, 1)
}

# ---- Paths
$clientPath = "app\admin\livetrips\LiveTripsClient.tsx"
$mapPath    = "app\admin\livetrips\components\LiveTripsMap.tsx"
$panelPath  = "app\admin\livetrips\components\DispatchActionPanel.tsx"

foreach ($p in @($clientPath,$mapPath,$panelPath)) {
  if (-not (Test-Path $p)) { throw "Missing file: $p" }
}

Backup-File $clientPath
Backup-File $mapPath
Backup-File $panelPath

# =========================================================
# 1) LiveTripsClient.tsx — instant LEFT sync via window event
# =========================================================
$client = Read-Text $clientPath

# We expect setLiveTrips exists. If not, fail fast.
if ($client -notmatch "\bsetLiveTrips\b") {
  throw "LiveTripsClient.tsx: setLiveTrips not found. This fix expects liveTrips state to exist."
}

$eventBlock = @'

  // --- Instant UI sync: when DispatchActionPanel updates status successfully ---
  useEffect(() => {
    const handler = (ev: any) => {
      const d = (ev && (ev as any).detail) || {};
      const bookingCode = String(d.bookingCode || d.booking_code || "").trim();
      const toStatus = String(d.toStatus || d.status || "").trim();
      if (!bookingCode || !toStatus) return;

      // Update LEFT list immediately (no waiting for next refresh)
      setLiveTrips((prev: any[]) => {
        const arr = Array.isArray(prev) ? prev : [];
        return arr.map((t: any) => {
          const code = String(t?.booking_code || t?.bookingCode || "").trim();
          if (code !== bookingCode) return t;
          return {
            ...t,
            status: toStatus,
            updated_at: new Date().toISOString(),
            // Clear problem flags when completing/cancelling (safe even if fields don't exist)
            ...(toStatus === "completed" || toStatus === "cancelled" ? { is_problem: false, is_stuck: false } : {}),
          };
        });
      });
    };

    window.addEventListener("jr:tripStatusChanged", handler as any);
    return () => window.removeEventListener("jr:tripStatusChanged", handler as any);
  }, []);

'@

# Insert right after the first "useEffect(" inside the component area (safe: only once)
# Anchor: first occurrence of "useEffect(() => {" (very common in this file)
$client = Ensure-InsertedOnce `
  -s $client `
  -needle "jr:tripStatusChanged" `
  -insertAfter "useEffect(() => {" `
  -block $eventBlock

Write-Text $clientPath $client
Write-Host "OK: LiveTripsClient.tsx patched (instant left sync listener)" -ForegroundColor Green

# =========================================================
# 2) LiveTripsMap.tsx — keep Dispatch panel visible (fixed)
# =========================================================
$map = Read-Text $mapPath

# If already fixed-positioned, skip.
if ($map -match "jr-fixed-dispatch-panel") {
  Write-Host "OK: LiveTripsMap.tsx already has fixed dispatch panel wrapper." -ForegroundColor Green
} else {
  # Wrap the DispatchActionPanel JSX in a fixed container so it never disappears due to layout/overflow.
  # We find the <DispatchActionPanel ... /> block and wrap it.
  $map = Try-RegexReplace `
    -s $map `
    -pattern "<DispatchActionPanel[\s\S]*?\/>" `
    -replace @'
<div className="jr-fixed-dispatch-panel pointer-events-auto fixed right-4 bottom-4 z-[80] w-[360px] max-w-[92vw]">
$0
</div>
'@ `
    -desc "wrap DispatchActionPanel with fixed container"

  Write-Text $mapPath $map
  Write-Host "OK: LiveTripsMap.tsx patched (fixed Dispatch panel wrapper)" -ForegroundColor Green
}

# =========================================================
# 3) DispatchActionPanel.tsx — emit event + logical disable
# =========================================================
$panel = Read-Text $panelPath

# 3a) Insert event emitter helper (only once)
if ($panel -notmatch "jr:tripStatusChanged") {
  # Insert after imports (after last import line)
  $importIdx = ($panel.LastIndexOf("import "))
  if ($importIdx -lt 0) { throw "DispatchActionPanel.tsx: could not find imports." }

  # Find end of the last import statement by searching for the next semicolon/newline after last "import "
  $after = $panel.IndexOf("`n", $importIdx)
  if ($after -lt 0) { $after = 0 }

  $helper = @'

const emitTripStatusChanged = (bookingCode: string, toStatus: string) => {
  try {
    window.dispatchEvent(
      new CustomEvent("jr:tripStatusChanged", { detail: { bookingCode, toStatus } })
    );
  } catch {}
};

'@

  # Put helper after imports block: find first blank line after imports
  $rxImports = [regex]::new("(?s)^(?:import[^\n]*\n)+\s*\n")
  if ($rxImports.IsMatch($panel)) {
    $panel = $rxImports.Replace($panel, ('$0' + $helper), 1)
  } else {
    # fallback: just prepend
    $panel = $helper + $panel
  }

  Write-Host "OK: DispatchActionPanel.tsx inserted emitTripStatusChanged()" -ForegroundColor Green
}

# 3b) Ensure logical enable/disable booleans exist near the top of the component
if ($panel -notmatch "const\s+canOnTheWay") {
  # Insert after we detect a 'status' or 'trip' availability line.
  # We look for the first occurrence of "const status" or "const tripStatus"
  $panel = Try-RegexReplace `
    -s $panel `
    -pattern "(const\s+(status|tripStatus)[^;\n]*;)" `
    -replace @'
$1

  const _s = String(($2 as any) || status || tripStatus || "").toLowerCase().trim();
  const canOnTheWay = _s === "assigned" || _s === "pending";
  const canStartTrip = _s === "on_the_way";
  const canDropoff = _s === "on_trip";
'@ `
    -desc "insert canOnTheWay/canStartTrip/canDropoff guards"
}

# 3c) After successful status update call, emit event
# We inject emitTripStatusChanged(bookingCode, toStatus) inside the first `if (res.ok)` block that handles status updates.
# This is intentionally generic: it targets any fetch to /api/dispatch/status.
$panel = Try-RegexReplace `
  -s $panel `
  -pattern "(fetch\(\s*[`"']\/api\/dispatch\/status[`"'][\s\S]*?\)\s*;[\s\S]*?if\s*\(\s*res\.ok\s*\)\s*\{)" `
  -replace @'
$1
        // Instant sync for LEFT list / counters
        emitTripStatusChanged(String(payload?.bookingCode || bookingCode || ""), String(payload?.status || toStatus || ""));
'@ `
  -desc "emit event after res.ok for /api/dispatch/status"

# 3d) Button disable/gray-out by label (best-effort, won’t crash if UI differs)
# On the way
$panel = Try-RegexReplace `
  -s $panel `
  -pattern "(<button[^>]*>)(\s*On the way\s*)(<\/button>)" `
  -replace '$1$2$3' `
  -desc "no-op placeholder (keeps structure)"

# Add disabled + classes by matching common button props around the labels
$panel = Try-RegexReplace `
  -s $panel `
  -pattern "(<button)([^>]*)(>\s*On the way\s*<\/button>)" `
  -replace '$1$2 disabled={!canOnTheWay} className={`${" "}${(typeof className === "string" ? "" : "")}`.trim()} style={{}}$3' `
  -desc "best-effort disable On the way"

$panel = Try-RegexReplace `
  -s $panel `
  -pattern "(<button)([^>]*)(>\s*Start trip\s*<\/button>)" `
  -replace '$1$2 disabled={!canStartTrip}$3' `
  -desc "best-effort disable Start trip"

$panel = Try-RegexReplace `
  -s $panel `
  -pattern "(<button)([^>]*)(>\s*Drop off\s*<\/button>)" `
  -replace '$1$2 disabled={!canDropoff}$3' `
  -desc "best-effort disable Drop off"

Write-Text $panelPath $panel
Write-Host "OK: DispatchActionPanel.tsx patched (emit + logical enables; best-effort button disabling)" -ForegroundColor Green

Write-Host ""
Write-Host "DONE. Next steps:" -ForegroundColor Cyan
Write-Host "1) Stop dev server (Ctrl+C), then:" -ForegroundColor Cyan
Write-Host "2) npm run dev" -ForegroundColor Cyan
Write-Host "3) Test: click On the way / Start trip / Drop off -> LEFT list should update instantly." -ForegroundColor Cyan
