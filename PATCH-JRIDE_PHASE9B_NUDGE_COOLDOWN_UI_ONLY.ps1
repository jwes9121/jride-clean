# PATCH-JRIDE_PHASE9B_NUDGE_COOLDOWN_UI_ONLY.ps1
# UI-only: After Nudge, suppress PROBLEM badge + problem count/filter for a cooldown window.
# No backend, no schema, no Mapbox edits. ASCII only. PowerShell 5 compatible.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw $m }

$path = Join-Path (Get-Location) "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $path -Raw

# 1) Insert Phase 9B constants + helper functions right after nudgedAt state
$anchor1 = '  const [nudgedAt, setNudgedAt] = useState<Record<string, number>>({});'
if ($txt -notmatch [regex]::Escape($anchor1)) { Fail "Anchor not found: nudgedAt state" }

$insert1 = @"
$anchor1

  // ===== PHASE 9B: UI-only auto-resolve (nudge cooldown) =====
  // After Nudge, hide PROBLEM badge/count/filter for a cooldown window.
  // If still stuck after cooldown, PROBLEM can re-appear.
  const NUDGE_COOLDOWN_MS = 6 * 60 * 1000; // 6 minutes
  const NUDGE_MAX_KEEP_MS = 30 * 60 * 1000; // safety prune

  function isCoolingTrip(key: string): boolean {
    return recentlyNudged(nudgedAt, key, NUDGE_COOLDOWN_MS);
  }

  function isProblemEffective(t: TripRow): boolean {
    const key = tripKey(t);
    if (!key) return isProblemTrip(t);
    if (isCoolingTrip(key)) return false;
    return isProblemTrip(t);
  }

"@
$txt = $txt.Replace($anchor1, $insert1)
Ok "Inserted Phase 9B cooldown constants + helpers."

# 2) Insert pruning useEffect after initial load useEffect (keeps nudgedAt tidy)
$anchor2 = @"
  useEffect(() => {
    loadPage().catch((e) => setLastAction(String(e?.message || e)));
    loadDrivers().catch(() => {});
  }, []);
"@
if ($txt -notmatch [regex]::Escape($anchor2)) { Fail "Anchor not found: initial load useEffect" }

$insert2 = @"
$anchor2

  // Prune nudgedAt:
  // - trip disappeared
  // - trip completed/cancelled
  // - trip updated after nudge (activity happened)
  // - no longer a problem
  // - too old record
  useEffect(() => {
    const now = Date.now();
    setNudgedAt((prev) => {
      const keys = Object.keys(prev || {});
      if (!keys.length) return prev;

      const next: Record<string, number> = { ...(prev || {}) };
      let changed = false;

      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const nAt = (next as any)[k] as number | undefined;
        if (!nAt) { delete (next as any)[k]; changed = true; continue; }

        if (now - nAt > NUDGE_MAX_KEEP_MS) { delete (next as any)[k]; changed = true; continue; }

        const tr = allTrips.find((t) => tripKey(t) === k) || null;
        if (!tr) { delete (next as any)[k]; changed = true; continue; }

        const st = effectiveStatus(tr);
        if (st === "completed" || st === "cancelled") { delete (next as any)[k]; changed = true; continue; }

        const upd = new Date((tr as any)?.updated_at || (tr as any)?.created_at || 0).getTime() || 0;
        if (upd && upd > nAt) { delete (next as any)[k]; changed = true; continue; }

        if (!isProblemTrip(tr)) { delete (next as any)[k]; changed = true; continue; }
      }

      return changed ? next : prev;
    });
  }, [allTrips]);

"@
$txt = $txt.Replace($anchor2, $insert2)
Ok "Inserted nudgedAt pruning useEffect."

# 3) Patch counts: count effective problems (not cooling) and add nudgedAt dependency
$needleCounts = '      if (isProblemTrip(t)) c.problem++;'
if ($txt -notmatch [regex]::Escape($needleCounts)) { Fail "Needle not found in counts: isProblemTrip(t)" }
$txt = $txt.Replace($needleCounts, '      if (isProblemEffective(t)) c.problem++;')
Ok "Counts: problem count now uses isProblemEffective."

$needleCountsDeps = '  }, [allTrips]);'
if ($txt -notmatch [regex]::Escape($needleCountsDeps)) { Fail "Counts deps anchor not found" }
# Replace only the first occurrence after counts block by targeting the exact deps line (safe in this file)
$txt = [regex]::Replace($txt, [regex]::Escape($needleCountsDeps), '  }, [allTrips, nudgedAt]);', 1)
Ok "Counts: dependencies include nudgedAt."

# 4) Patch visibleTrips: problem filter uses effective problem; add nudgedAt dependency
$needleProblemFilter = '    if (tripFilter === "problem") return allTrips.filter((t) => isProblemTrip(t));'
if ($txt -notmatch [regex]::Escape($needleProblemFilter)) { Fail "Problem filter line not found" }
$txt = $txt.Replace($needleProblemFilter, '    if (tripFilter === "problem") return allTrips.filter((t) => isProblemEffective(t));')
Ok "VisibleTrips: problem filter uses isProblemEffective."

$needleVisibleDeps = '  }, [tripFilter, allTrips]);'
if ($txt -notmatch [regex]::Escape($needleVisibleDeps)) { Fail "VisibleTrips deps anchor not found" }
$txt = $txt.Replace($needleVisibleDeps, '  }, [tripFilter, allTrips, nudgedAt]);')
Ok "VisibleTrips: dependencies include nudgedAt."

# 5) Patch row vars: prob becomes effective, keep probRaw for actions
$needleProbRow = '                  const prob = isProblemTrip(t);'
if ($txt -notmatch [regex]::Escape($needleProbRow)) { Fail "Row prob line not found" }

$repProbRow = @"
                  const probRaw = isProblemTrip(t);
                  const cooling = probRaw && isCoolingTrip(key);
                  const prob = probRaw && !cooling;
"@
$txt = $txt.Replace($needleProbRow, $repProbRow)
Ok "Row: added probRaw + cooling + prob(effective)."

# 6) Patch PROBLEM badge rendering to show COOLDOWN during cooldown
$needleProblemBadge = '                          {prob ? <span className={badgeClass("problem")}>PROBLEM</span> : null}'
if ($txt -notmatch [regex]::Escape($needleProblemBadge)) { Fail "Problem badge JSX not found" }

$repProblemBadge = @"
                          {prob ? <span className={badgeClass("problem")}>PROBLEM</span> : (cooling ? <span className={badgeClass("stale")}>COOLDOWN</span> : null)}
"@
$txt = $txt.Replace($needleProblemBadge, $repProblemBadge)
Ok "Badge: PROBLEM replaced with PROBLEM/COOLDOWN logic."

# 7) Patch status badge color selection to avoid red during cooldown
$needleStatusBadge = '                        <span className={badgeClass(prob ? "problem" : stale ? "stale" : "ok")}>{sRaw || sEff}</span>'
if ($txt -notmatch [regex]::Escape($needleStatusBadge)) { Fail "Status badge JSX not found" }

$repStatusBadge = '                        <span className={badgeClass(prob ? "problem" : (stale || cooling) ? "stale" : "ok")}>{sRaw || sEff}</span>'
$txt = $txt.Replace($needleStatusBadge, $repStatusBadge)
Ok "Status badge: cooling no longer shows as problem-red."

# 8) Ensure problem actions still show during cooldown (use probRaw)
# Replace "{prob ? (" with "{probRaw ? (" in the problem actions section
$needleActionsOpen = '                          {prob ? ('
if ($txt -notmatch [regex]::Escape($needleActionsOpen)) { Fail "Problem actions open block not found" }
$txt = $txt.Replace($needleActionsOpen, '                          {probRaw ? (')
Ok "Problem actions: kept available during cooldown (probRaw)."

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched file saved: $path"
Ok "Phase 9B patch complete."
