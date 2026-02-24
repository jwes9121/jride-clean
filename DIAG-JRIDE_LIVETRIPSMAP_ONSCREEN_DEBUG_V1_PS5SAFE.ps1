param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$absPath, [string]$tag, [string]$bakRoot) {
  if (!(Test-Path -LiteralPath $absPath)) { return $null }
  New-Item -ItemType Directory -Force -Path $bakRoot | Out-Null
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path -Leaf $absPath
  $bak = Join-Path $bakRoot ($name + ".bak." + $tag + "." + $ts)
  Copy-Item -LiteralPath $absPath -Destination $bak -Force
  return $bak
}

Info "== JRIDE DIAG Patch: LiveTripsMap on-screen overlay (stamp + props vs fetch) (V1 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"
$mapPath = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"

if (!(Test-Path -LiteralPath $mapPath)) { Fail "[FAIL] LiveTripsMap.tsx not found: $mapPath" }

$bak = BackupFile $mapPath "LIVETRIPSMAP_DEBUG_OVERLAY_V1" $bakRoot
if ($bak) { Ok "[OK] Backup: $bak" }

$txt = [System.IO.File]::ReadAllText($mapPath, [System.Text.Encoding]::UTF8)

# Idempotency check
if ($txt -match "JRIDE_DEBUG_OVERLAY_STAMP_V1") {
  Warn "[WARN] Debug overlay already present. No changes made."
  Ok "[NEXT] Run: npm.cmd run build"
  exit 0
}

# 1) Inject state + effect near mapReady state (robust)
$stateAnchor = '(?ms)(const\s+\[mapReady,\s*setMapReady\]\s*=\s*useState\(false\);\s*)'
if ($txt -notmatch $stateAnchor) {
  Fail "[FAIL] Could not locate mapReady state line to inject debug state."
}

$stamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
$stateInject = @"
`$1
  // JRIDE_DEBUG_OVERLAY_STAMP_V1 ($stamp)
  const JRIDE_DEBUG_STAMP = "JRIDE_DEBUG_OVERLAY_STAMP_V1_$stamp";
  const [debugFetchedDrivers, setDebugFetchedDrivers] = useState<any[] | null>(null);
  const [debugFetchErr, setDebugFetchErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/driver_locations?pretty=0", { cache: "no-store" });
        const j: any = await res.json().catch(() => null);
        const arr = (j && Array.isArray(j.drivers)) ? j.drivers : (Array.isArray(j) ? j : []);
        if (!cancelled) setDebugFetchedDrivers(arr);
      } catch (e: any) {
        if (!cancelled) setDebugFetchErr(String(e?.message ?? e));
      }
    })();
    return () => { cancelled = true; };
  }, []);
"@

$txt = [System.Text.RegularExpressions.Regex]::Replace(
  $txt,
  $stateAnchor,
  $stateInject,
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)
Ok "[OK] Injected debug state + fetch effect."

# 2) Inject overlay UI right after the opening map container wrapper
$jsxAnchor = '(?ms)(<div\s+className="relative\s+h-full\s+w-full">\s*)'
if ($txt -notmatch $jsxAnchor) {
  Fail "[FAIL] Could not locate <div className=\"relative h-full w-full\"> to inject overlay."
}

$overlay = @'
$1
        {/* JRIDE_DEBUG_OVERLAY_STAMP_V1 */}
        <div className="pointer-events-auto absolute top-16 left-3 z-[9999] w-[360px] max-w-[92vw] rounded-xl bg-black/80 p-3 text-[11px] text-white shadow-lg">
          <div className="mb-1 text-[12px] font-extrabold">LIVE MAP DEBUG</div>
          <div className="mb-2 break-all opacity-90">Stamp: {JRIDE_DEBUG_STAMP}</div>

          <div className="mb-2 rounded-md bg-white/10 p-2">
            <div className="font-bold">Props drivers</div>
            <div>count: {(drivers ? (drivers as any[]).length : 0)}</div>
            <div className="mt-1 break-all">
              first: {drivers && (drivers as any[]).length ? JSON.stringify((drivers as any[])[0]) : "none"}
            </div>
          </div>

          <div className="rounded-md bg-white/10 p-2">
            <div className="font-bold">Client fetch /api/admin/driver_locations</div>
            <div>err: {debugFetchErr ?? "none"}</div>
            <div>count: {debugFetchedDrivers ? debugFetchedDrivers.length : (debugFetchedDrivers === null ? "loading" : 0)}</div>
            <div className="mt-1 break-all">
              first: {debugFetchedDrivers && debugFetchedDrivers.length ? JSON.stringify(debugFetchedDrivers[0]) : (debugFetchedDrivers === null ? "loading" : "none")}
            </div>
          </div>
        </div>
'@

$txt = [System.Text.RegularExpressions.Regex]::Replace(
  $txt,
  $jsxAnchor,
  $overlay,
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)
Ok "[OK] Injected on-screen overlay UI."

WriteUtf8NoBom $mapPath $txt
Ok "[OK] Wrote LiveTripsMap.tsx (UTF-8 no BOM)."
Ok "[NEXT] Run: npm.cmd run build"