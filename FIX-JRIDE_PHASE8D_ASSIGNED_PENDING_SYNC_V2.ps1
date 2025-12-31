# FIX-JRIDE_PHASE8D_ASSIGNED_PENDING_SYNC_V2.ps1
# Fix: Assigned count/list mismatch by using "effectiveStatus" + "hasDriver"
# Anchor injection after function normStatus(...) instead of minutesSince(...)

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Backup($p){
  if(!(Test-Path $p)){ Fail "Missing file: $p" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak.$ts"
  Copy-Item $p $bak -Force
  Write-Host "[OK] Backup: $bak" -ForegroundColor Green
}
function ReadUtf8($p){
  $t = Get-Content -LiteralPath $p -Raw -Encoding UTF8
  if($t.Length -gt 0 -and [int]$t[0] -eq 0xFEFF){ $t = $t.Substring(1) }
  return $t
}
function WriteUtf8NoBom($p,$t){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $t, $utf8NoBom)
}

$clientPath = "app\admin\livetrips\LiveTripsClient.tsx"
Backup $clientPath

$txt = ReadUtf8 $clientPath

# 0) Sanitize literal \r\n and `r`n artifacts if present
$txt = [regex]::Replace($txt, "\\r\\n", "`r`n")
$txt = $txt.Replace("``r``n", "`r`n")

# 1) Ensure isActiveTripStatus is clean (replace whole function if found)
$patActive = [regex]::new("function\s+isActiveTripStatus\s*\(\s*s:\s*string\s*\)\s*\{[\s\S]*?\}", "Singleline")
if ($patActive.IsMatch($txt)) {
  $repActive = @'
function isActiveTripStatus(s: string) {
  return ["pending", "assigned", "on_the_way", "arrived", "enroute", "on_trip"].includes(s);
}
'@
  $txt = $patActive.Replace($txt, $repActive, 1)
  Write-Host "[OK] Replaced isActiveTripStatus()" -ForegroundColor Green
} else {
  Write-Host "[WARN] isActiveTripStatus() not found (skip)" -ForegroundColor Yellow
}

# 2) Inject hasDriver() + effectiveStatus() after normStatus() (anchor must exist)
if ($txt -notmatch "function\s+hasDriver\s*\(") {
  $anchor = [regex]::new("function\s+normStatus\s*\([^)]*\)\s*\{[\s\S]*?\}\s*", "Singleline")
  if (!$anchor.IsMatch($txt)) { Fail "Could not locate normStatus() to anchor helper injection." }

  $helpers = @'
function hasDriver(t: any): boolean {
  if (!t) return false;
  const v =
    (t as any).driver_id ??
    (t as any).assigned_driver_id ??
    (t as any).assignedDriverId ??
    (t as any).driverId ??
    null;
  return v != null && String(v).length > 0;
}

// UI-effective status:
// If backend says "assigned" but no driver is attached, treat as "pending"
function effectiveStatus(t: any): string {
  const s = normStatus((t as any)?.status);
  if (s === "assigned" && !hasDriver(t)) return "pending";
  if (s === "requested") return "pending";
  return s;
}
'@

  $m = $anchor.Match($txt)
  $injectAt = $m.Index + $m.Length
  $txt = $txt.Insert($injectAt, "`r`n" + $helpers + "`r`n")
  Write-Host "[OK] Injected hasDriver() + effectiveStatus() after normStatus()" -ForegroundColor Green
} else {
  Write-Host "[OK] hasDriver() already present (skip injection)" -ForegroundColor Green
}

# 3) Patch counts useMemo to use effectiveStatus()
$patCounts = [regex]::new("const\s+counts\s*=\s*useMemo\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[allTrips\]\s*\)\s*;", "Singleline")
if ($patCounts.IsMatch($txt)) {
  $repCounts = @'
const counts = useMemo(() => {
  const c = {
    dispatch: 0,
    pending: 0,
    assigned: 0,
    on_the_way: 0,
    arrived: 0,
    enroute: 0,
    on_trip: 0,
    completed: 0,
    cancelled: 0,
    problem: 0,
  };

  for (const t of allTrips) {
    const s = effectiveStatus(t);

    if (s === "pending") c.pending++;
    if (s === "assigned") c.assigned++;
    if (s === "on_the_way") c.on_the_way++;
    if (s === "arrived") c.arrived++;
    if (s === "enroute") c.enroute++;
    if (s === "on_trip") c.on_trip++;
    if (s === "completed") c.completed++;
    if (s === "cancelled") c.cancelled++;

    if (["pending","assigned","on_the_way","arrived","enroute","on_trip"].includes(s)) c.dispatch++;

    if (computeIsProblem(t)) c.problem++;
  }

  return c;
}, [allTrips]);
'@
  $txt = $patCounts.Replace($txt, $repCounts, 1)
  Write-Host "[OK] Patched counts useMemo to use effectiveStatus()" -ForegroundColor Green
} else {
  Fail "Could not locate counts useMemo() to patch."
}

# 4) Patch visibleTrips useMemo to use effectiveStatus()
$patVisible = [regex]::new("const\s+visibleTrips\s*=\s*useMemo\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[tripFilter,\s*allTrips,\s*stuckTripIds\]\s*\)\s*;", "Singleline")
if ($patVisible.IsMatch($txt)) {
  $repVisible = @'
const visibleTrips = useMemo(() => {
  const f = tripFilter;

  let out: TripRow[] = [];

  if (f === "dispatch") {
    out = allTrips.filter((t) =>
      ["pending","assigned","on_the_way","arrived","enroute","on_trip"].includes(effectiveStatus(t))
    );
  } else if (f === "problem") {
    out = allTrips.filter((t) => stuckTripIds.has(normTripId(t as any)));
  } else if (f === "on_the_way") {
    out = allTrips.filter((t) => effectiveStatus(t) === "on_the_way");
  } else {
    out = allTrips.filter((t) => effectiveStatus(t) === f);
  }

  out.sort((a, b) => {
    const ta = new Date((a as any).updated_at || (a as any).created_at || 0).getTime() || 0;
    const tb = new Date((b as any).updated_at || (b as any).created_at || 0).getTime() || 0;
    return tb - ta;
  });

  return out;
}, [tripFilter, allTrips, stuckTripIds]);
'@
  $txt = $patVisible.Replace($txt, $repVisible, 1)
  Write-Host "[OK] Patched visibleTrips to use effectiveStatus()" -ForegroundColor Green
} else {
  Fail "Could not locate visibleTrips useMemo() with deps [tripFilter, allTrips, stuckTripIds]."
}

WriteUtf8NoBom $clientPath $txt
Write-Host "[OK] Wrote: $clientPath" -ForegroundColor Green

Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host 'Build: powershell -NoProfile -ExecutionPolicy Bypass -Command "npm run build"'
