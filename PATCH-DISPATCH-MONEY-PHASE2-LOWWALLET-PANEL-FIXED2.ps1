# PATCH-DISPATCH-MONEY-PHASE2-LOWWALLET-PANEL-FIXED2.ps1
# Money Phase 2 UI fix: wire lowWalletDrivers from /api/dispatch/drivers-live
# - If an existing fetch("/api/dispatch/drivers-live") exists, inject setLowWalletDrivers()
# - Else create loadDriversLive() and wire into refresh loop
# Touches ONLY: app\dispatch\page.tsx
# Reversible via backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$ui = "app\dispatch\page.tsx"
if (-not (Test-Path $ui)) { Fail "Missing file: $ui (run from repo root)" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$ui.bak.$stamp"
Copy-Item -Force $ui $bak
Ok "Backup UI: $bak"

$txt = Get-Content $ui -Raw

# 0) Ensure Money Phase 2 state exists (if not, insert after Driver Health state end or dispatcherName)
if ($txt -notmatch "JRIDE_UI_MONEY_PHASE2_START") {
  $stateInsert = @"

  /* JRIDE_UI_MONEY_PHASE2_START */
  const [lowWalletDrivers, setLowWalletDrivers] = useState<any[]>([]);
  const [showLowWalletPanel, setShowLowWalletPanel] = useState<boolean>(true);
  /* JRIDE_UI_MONEY_PHASE2_END */
"@

  if ($txt -match [regex]::Escape("/* JRIDE_UI_DRIVER_HEALTH_STATE_END */")) {
    $txt = $txt.Replace("/* JRIDE_UI_DRIVER_HEALTH_STATE_END */", "/* JRIDE_UI_DRIVER_HEALTH_STATE_END */" + $stateInsert)
    Ok "Inserted Money Phase 2 state after Driver Health state block."
  } else {
    $rxDisp = '(?m)^\s*const\s+\[dispatcherName,\s*setDispatcherName\]\s*=\s*useState<[^>]+>\(""\);\s*$'
    $m = [regex]::Match($txt, $rxDisp)
    if (-not $m.Success) { Fail "Could not find dispatcherName state line to anchor Money Phase 2 state insertion." }
    $txt = [regex]::Replace($txt, $rxDisp, [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $mm.Value + $stateInsert }, 1)
    Ok "Inserted Money Phase 2 state after dispatcherName state."
  }
} else {
  Warn "Money Phase 2 state already present."
}

# 1) Try to patch an existing fetch("/api/dispatch/drivers-live") JSON parse to also setLowWalletDrivers.
if ($txt -notmatch "setLowWalletDrivers") {
  $rxFetchBlock = '(?s)(fetch\(\s*["'']\/api\/dispatch\/drivers-live["''][\s\S]*?\)\s*;?)'
  $mf = [regex]::Match($txt, $rxFetchBlock)

  if ($mf.Success) {
    # Find the JSON parse line near the fetch usage, then inject lowWalletDrivers set.
    # We patch globally but only once: locate "const j = await r.json().catch(() => ({}));"
    $rxJsonLine = '(?s)(const\s+j\s*=\s*await\s+r\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\);\s*)'
    $mj = [regex]::Match($txt, $rxJsonLine)
    if ($mj.Success) {
      $inject = $mj.Groups[1].Value + @"
    const low = Array.isArray((j as any)?.lowWalletDrivers) ? (j as any).lowWalletDrivers : [];
    setLowWalletDrivers(low);
"@
      $txt2 = [regex]::Replace($txt, $rxJsonLine, [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $inject }, 1)
      if ($txt2 -ne $txt) {
        $txt = $txt2
        Ok "Injected setLowWalletDrivers() after JSON parse."
      } else {
        Warn "JSON parse line patch produced no change."
      }
    } else {
      Warn "Could not find JSON parse line. Will add a dedicated loader function instead."
    }
  } else {
    Warn "No fetch('/api/dispatch/drivers-live') found. Will add a dedicated loader function."
  }
} else {
  Warn "setLowWalletDrivers already present; skipping loader injection."
}

# 2) If we still don't have any setLowWalletDrivers call, create a loader function and wire it
if ($txt -notmatch "setLowWalletDrivers") {
  # Insert a dedicated loader near loadObs() (or near other loaders)
  $rxLoadObsBlock = '(?s)(async function loadObs\(\)\s*\{[\s\S]*?\}\s*)'
  $mObs = [regex]::Match($txt, $rxLoadObsBlock)
  if (-not $mObs.Success) { Fail "Could not find loadObs() block to anchor loadDriversLive() insertion." }

  $loader = @"

  /* JRIDE_UI_MONEY_PHASE2_LOAD_START */
  async function loadDriversLiveMoney() {
    const r = await fetch("/api/dispatch/drivers-live", { cache: "no-store" });
    const j = await r.json().catch(() => ({} as any));

    const low = Array.isArray((j as any)?.lowWalletDrivers) ? (j as any).lowWalletDrivers : [];
    setLowWalletDrivers(low);
  }
  /* JRIDE_UI_MONEY_PHASE2_LOAD_END */
"@

  $txt = $txt.Replace($mObs.Groups[1].Value, $mObs.Groups[1].Value + $loader)
  Ok "Inserted loadDriversLiveMoney() loader."

  # Wire it into refresh loop: add after loadObs().catch(() => {});
  $rxObsCall = 'loadObs\(\)\.catch\(\(\)\s*=>\s*\{\}\)\s*;'
  if ($txt -match $rxObsCall) {
    $txt = [regex]::Replace(
      $txt,
      $rxObsCall,
      [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $mm.Value + "`n      loadDriversLiveMoney().catch(() => {});" },
      1
    )
    Ok "Wired loadDriversLiveMoney() into refresh loop after loadObs()."
  } else {
    Warn "Could not find loadObs().catch(() => {}); call to wire loader. You may still call it manually later."
  }
}

# 3) Insert the panel UI after the 'Showing:' span (if not already present)
if ($txt -notmatch "JRIDE_UI_MONEY_PHASE2_PANEL_START") {
  $panel = @'
              {/* JRIDE_UI_MONEY_PHASE2_PANEL_START */}
              <div className="mt-3 rounded border bg-white p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Low-wallet drivers</div>
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                    onClick={() => setShowLowWalletPanel((v) => !v)}
                  >
                    {showLowWalletPanel ? "Hide" : "Show"}
                  </button>
                </div>

                {showLowWalletPanel ? (
                  <div className="mt-2 max-h-48 overflow-auto">
                    {lowWalletDrivers?.length ? (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-600">
                            <th className="py-1 pr-2">Driver</th>
                            <th className="py-1 pr-2">Balance</th>
                            <th className="py-1 pr-2">Min</th>
                            <th className="py-1 pr-2">Last seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lowWalletDrivers.slice(0, 50).map((d: any) => {
                            const live = (driverLiveMap as any)?.[String(d?.id)] || null;
                            const seen = String(live?.location_updated_at || live?.updated_at || "");
                            const m = minsAgo(seen || null);
                            const last = m === null ? "unknown" : (m === 0 ? "now" : `${m}m`);

                            const bal = toMoney(d?.wallet_balance);
                            const min = toMoney(d?.min_wallet_required);

                            return (
                              <tr key={String(d?.id)} className="border-t">
                                <td className="py-1 pr-2">
                                  <button
                                    type="button"
                                    className="text-left underline decoration-dotted hover:text-slate-900"
                                    onClick={() => {
                                      setLowWalletOnly(true);
                                    }}
                                    title="Enable Low-wallet only filter"
                                  >
                                    {String(d?.driver_name || ("Driver " + String(d?.id || "").slice(0, 6)))}
                                  </button>
                                </td>
                                <td className="py-1 pr-2 text-red-700">{bal === null ? "?" : `₱${bal.toFixed(2)}`}</td>
                                <td className="py-1 pr-2">{min === null ? "?" : `₱${min.toFixed(2)}`}</td>
                                <td className="py-1 pr-2 text-slate-500">{last}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-slate-500">No low-wallet drivers.</div>
                    )}
                  </div>
                ) : null}
              </div>
              {/* JRIDE_UI_MONEY_PHASE2_PANEL_END */}
'@

  $rxShowing = '(?s)(<span className="text-xs text-slate-500 ml-2">\s*Showing:\s*\{rowsFilteredUi\.length\}\s*\/\s*\{rowsForExport\.length\}\s*<\/span>\s*)'
  $mx = [regex]::Match($txt, $rxShowing)
  if (-not $mx.Success) { Fail "Could not locate the 'Showing:' span to insert panel after it." }

  $txt = [regex]::Replace(
    $txt,
    $rxShowing,
    [System.Text.RegularExpressions.MatchEvaluator]{ param($mm) $mm.Groups[1].Value + "`n" + $panel + "`n" },
    1
  )
  Ok "Inserted Low-wallet drivers panel UI."
} else {
  Warn "Low-wallet panel already present; skipping."
}

Set-Content -Encoding UTF8 $ui $txt
Ok "Wrote UI: $ui"

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "1) npm run build" -ForegroundColor Cyan
Write-Host "2) npm run dev -> /dispatch: panel should show low-wallet drivers" -ForegroundColor Cyan
