$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $repo "app\admin\livetrips\LiveTripsClient.tsx"

if (!(Test-Path $file)) { Fail "LiveTripsClient.tsx not found" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $file "$file.bak.$stamp" -Force
Write-Host "[OK] Backup created"

$txt = Get-Content $file -Raw

# Find stuckTripIds useMemo block
$rx = [regex]'(?s)const\s+stuckTripIds\s*=\s*useMemo\(\(\)\s*=>\s*\{.*?\}\s*,\s*\[\s*allTrips\s*\]\s*\)\s*;'
$m = $rx.Match($txt)
if (!$m.Success) {
  Fail "Could not find stuckTripIds useMemo block. Paste this block if formatting changed."
}

$replacement = @'
const stuckTripIds = useMemo(() => {
  const s = new Set<string>();

  for (const t of allTrips) {
    const tripType = String((t as any).trip_type || (t as any).tripType || "").trim().toLowerCase();
    const code = String((t as any).booking_code || "").trim().toUpperCase();

    const isTakeout =
      tripType === "takeout" ||
      code.startsWith("TAKEOUT-") ||
      code.startsWith("TAKEOUT_") ||
      code.startsWith("TAKEOUT");

    // TAKEOUT trips are never considered "problem"
    if (isTakeout) continue;

    if (computeIsProblem(t)) {
      const id = normTripId(t);
      if (id) s.add(id);
    }
  }

  return s;
}, [allTrips]);
'@

$txt2 = $rx.Replace($txt, $replacement, 1)
Set-Content -Path $file -Value $txt2 -Encoding UTF8

Write-Host "[DONE] TAKEOUT removed from stuckTripIds (PROBLEM badge source)." -ForegroundColor Green
