# PATCH-JRIDE_DRIVER_PAX_CONFIRM_P3_DRIVER_BADGE.ps1
# P3: Add a driver-visible pax badge using latest persisted confirmation.
# - Adds GET /api/driver/pax-confirm/latest (service role read)
# - Patches the Driver TSX containing DRIVER_PAX_CONFIRM_P1_UI_ONLY to fetch latest and render a small banner
# ASCII-only, UTF-8 no BOM

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function EnsureDir($p){
  if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

function WriteUtf8NoBom($path, $content){
  EnsureDir (Split-Path -Parent $path)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
  [System.IO.File]::WriteAllBytes($path, $bytes)
}

$root = (Get-Location).Path
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

# 1) Add API route: /api/driver/pax-confirm/latest
$routePath = Join-Path $root "app\api\driver\pax-confirm\latest\route.ts"
if (Test-Path $routePath) {
  $bak = "$routePath.bak.$stamp"
  Copy-Item $routePath $bak -Force
  Write-Host "[OK] Backup route: $bak"
}

$route = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(data: any, status: number = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const ride_id = String(u.searchParams.get("ride_id") || "");

    if (!ride_id) return json({ ok: false, error: "MISSING_RIDE_ID" }, 400);

    const url =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";

    const service =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      process.env.SUPABASE_SERVICE_KEY ||
      "";

    if (!url || !service) {
      return json({ ok: false, error: "SERVER_MISSING_SUPABASE_SERVICE_ROLE" }, 500);
    }

    const sb = createClient(url, service, { auth: { persistSession: false } });

    const { data, error } = await sb
      .from("ride_pax_confirmations")
      .select("matches, booked_pax, actual_pax, reason, created_at")
      .eq("ride_id", ride_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) return json({ ok: false, error: error.message }, 500);

    const row = (data && data.length ? data[0] : null);
    return json({ ok: true, row });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
'@

WriteUtf8NoBom $routePath $route
Write-Host "[OK] Wrote route: $routePath"

# 2) Locate driver file by marker
Write-Host "[INFO] Locating Driver UI TSX containing DRIVER_PAX_CONFIRM_P1_UI_ONLY..."
$candidates = Get-ChildItem -Path $root -Recurse -File -Filter "*.tsx" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "\\node_modules\\|\\.next\\|\\dist\\|\\build\\|\\out\\|\\coverage\\|\\.bak\\." }

$driverFile = $null
foreach ($f in $candidates) {
  try {
    $raw = Get-Content $f.FullName -Raw -Encoding utf8
    if ($raw -match "DRIVER_PAX_CONFIRM_P1_UI_ONLY") { $driverFile = $f.FullName; break }
  } catch { }
}
if (-not $driverFile) { Fail "Driver TSX with marker not found: DRIVER_PAX_CONFIRM_P1_UI_ONLY" }

$driverBak = "$driverFile.bak.$stamp"
Copy-Item $driverFile $driverBak -Force
Write-Host "[OK] Backup driver file: $driverBak"
Write-Host "[OK] Target driver file: $driverFile"

$txt = Get-Content $driverFile -Raw -Encoding utf8

# 3) Add state for latest pax confirmation if missing
if ($txt -notmatch "paxLatest") {
  $anchorState = 'const [paxPersistError, setPaxPersistError] = useState<string>("");'
  if ($txt.IndexOf($anchorState) -lt 0) { Fail "Anchor not found: paxPersistError state" }

  $stateAdd = @'
const [paxPersistError, setPaxPersistError] = useState<string>("");
  const [paxLatest, setPaxLatest] = useState<any>(null);
  const [paxLatestErr, setPaxLatestErr] = useState<string>("");
'@
  $txt = $txt.Replace($anchorState, $stateAdd)
  Write-Host "[OK] Added paxLatest + paxLatestErr state"
} else {
  Write-Host "[OK] paxLatest already present (skip)"
}

# 4) Add effect to fetch latest pax confirmation when assigned ride changes
if ($txt -notmatch "pax-confirm/latest") {
  $fmtAnchor = "function formatDate("
  $idx = $txt.IndexOf($fmtAnchor)
  if ($idx -lt 0) { Fail "Anchor not found: function formatDate(" }

  $effect = @'
  // P3: load latest persisted pax confirmation for this ride (read-only)
  useEffect(() => {
    (async () => {
      try {
        setPaxLatestErr("");
        const rideId = (assigned as any)?.id;
        if (!rideId) { setPaxLatest(null); return; }

        const res = await fetch(`/api/driver/pax-confirm/latest?ride_id=${encodeURIComponent(String(rideId))}`);
        const j = await res.json().catch(() => ({} as any));
        if (!res.ok || !j?.ok) {
          setPaxLatest(null);
          setPaxLatestErr(String(j?.error || "PAX_LATEST_LOAD_FAILED"));
          return;
        }
        setPaxLatest(j.row || null);
      } catch (e: any) {
        setPaxLatest(null);
        setPaxLatestErr(String(e?.message || "PAX_LATEST_LOAD_FAILED"));
      }
    })();
  }, [(assigned as any)?.id]);

'@

  $txt = $txt.Substring(0, $idx) + $effect + $txt.Substring($idx)
  Write-Host "[OK] Inserted P3 paxLatest useEffect before formatDate()"
} else {
  Write-Host "[OK] pax-confirm/latest effect already present (skip)"
}

# 5) Render a small banner near the top of the page inside the root return div
# We insert after the first <div ...> that follows return (
$ri = $txt.IndexOf("return (")
if ($ri -lt 0) { Fail "Could not find return (" }

$divi = $txt.IndexOf("<div", $ri)
if ($divi -lt 0) { Fail "Could not find first <div after return (" }

$gt = $txt.IndexOf(">", $divi)
if ($gt -lt 0) { Fail "Could not find end of first <div tag" }

if ($txt -notmatch "P3 PAX badge") {
  $banner = @'

      {/* P3 PAX badge (read-only) */}
      {assigned ? (
        <div className="mb-3 rounded-2xl border border-black/10 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs opacity-70">
              Booked pax: <span className="font-mono">{getBookedPax(assigned as any)}</span>
            </div>

            {paxLatest ? (
              <div className="flex items-center gap-2">
                {paxLatest.matches === false ? (
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                    PAX mismatch reported
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                    PAX confirmed
                  </span>
                )}
                <span className="text-[11px] opacity-60">
                  {paxLatest.created_at ? String(paxLatest.created_at) : ""}
                </span>
              </div>
            ) : paxLatestErr ? (
              <div className="text-[11px] text-rose-700">PAX status unavailable</div>
            ) : (
              <div className="text-[11px] opacity-60">No confirmation yet</div>
            )}
          </div>
        </div>
      ) : null}
      {/* END P3 PAX badge */}
'@

  $txt = $txt.Substring(0, $gt + 1) + $banner + $txt.Substring($gt + 1)
  Write-Host "[OK] Inserted P3 banner inside root return div"
} else {
  Write-Host "[OK] P3 banner already present (skip)"
}

WriteUtf8NoBom $driverFile $txt
Write-Host "[OK] Patched driver file: $driverFile"

Write-Host ""
Write-Host "RUN:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "RUN (one-liner):"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\PATCH-JRIDE_DRIVER_PAX_CONFIRM_P3_DRIVER_BADGE.ps1"
Write-Host ""
Write-Host "Commit/tag suggestion:"
Write-Host "  feat(driver): P3 show pax confirmation badge (read-only)"
Write-Host "  JRIDE_DRIVER_PAX_CONFIRM_P3_BADGE_GREEN"
