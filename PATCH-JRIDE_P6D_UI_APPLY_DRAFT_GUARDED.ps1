# PATCH-JRIDE_P6D_UI_APPLY_DRAFT_GUARDED.ps1
# P6D: UI-only - Add guarded Apply Draft + Copy + Reset around Proposed Fare (draft)
# HARD RULES: ANCHOR_BASED_ONLY, NO_DECLARE, NO_REDECLARE_NO_DECLARE, DO_NOT_TOUCH_DISPATCH_STATUS

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$target = Join-Path $root 'app\admin\livetrips\LiveTripsClient.tsx'
if(!(Test-Path $target)){ Fail "Target not found: $target" }

$txt = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# Anchor A: handleUseSuggestedFare exists
$anchorA = 'const handleUseSuggestedFare = (v: number) => {'
if($txt.IndexOf($anchorA) -lt 0){ Fail "Anchor not found: $anchorA" }

# Inject helpers immediately after handleUseSuggestedFare block end (anchor by the next state line)
$anchorAfter = 'const [nudgedAt, setNudgedAt] = useState<Record<string, number>>({});'
if($txt.IndexOf($anchorAfter) -lt 0){ Fail "Anchor not found: $anchorAfter" }

# Ensure we haven't already injected P6D helpers
if($txt.IndexOf("P6D: guarded draft helpers") -ge 0){
  Fail "P6D helpers already present in file (abort to avoid duplicates)."
}

# Backup
$bak = "$target.bak.$(Stamp)"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$helpers = @'
  // P6D: guarded draft helpers (UI-only; backend apply is intentionally disabled)
  const draftNum = useMemo(() => {
    const raw = String(proposedFareDraft ?? "").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n <= 0) return null;
    return n;
  }, [proposedFareDraft]);

  const tripFareNum = useMemo(() => {
    if (!selectedTrip) return null;
    const v =
      (selectedTrip as any)?.proposed_fare ??
      (selectedTrip as any)?.proposedFare ??
      (selectedTrip as any)?.verified_fare ??
      (selectedTrip as any)?.verifiedFare ??
      null;

    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }, [selectedTripId]);

  const draftStatusText = useMemo(() => {
    if (!selectedTrip) return "Select a trip to edit draft.";
    if (!String(proposedFareDraft ?? "").trim()) return "Draft is empty.";
    if (draftNum === null) return "Draft invalid (must be a number > 0).";
    if (tripFareNum !== null && Math.abs(draftNum - tripFareNum) < 0.0001) return "No changes vs current trip fare.";
    return "Draft ready (UI-only).";
  }, [selectedTrip, proposedFareDraft, draftNum, tripFareNum]);

  const canCopyDraft = useMemo(() => draftNum !== null, [draftNum]);
  const canResetDraft = useMemo(() => !!selectedTrip, [selectedTrip]);

  const applyDisabledReason = useMemo(() => {
    if (!selectedTrip) return "Select a trip first.";
    if (draftNum === null) return "Enter a valid draft (number > 0).";
    // Intentionally blocked until backend apply route is designed:
    return "Backend apply is not wired yet (UI-only draft).";
  }, [selectedTrip, draftNum]);

  const handleCopyDraft = async () => {
    try {
      if (draftNum === null) return;
      if (navigator && (navigator as any).clipboard && (navigator as any).clipboard.writeText) {
        await (navigator as any).clipboard.writeText(String(draftNum));
        setLastAction("Copied Proposed Fare (draft) to clipboard.");
      } else {
        setLastAction("Clipboard unavailable in this browser.");
      }
    } catch {
      setLastAction("Copy failed.");
    }
  };

  const handleResetDraft = () => {
    if (!selectedTrip) return;
    if (tripFareNum !== null) setProposedFareDraft(String(tripFareNum));
    else setProposedFareDraft("");
    setLastAction("Reset Proposed Fare (draft) from selected trip.");
  };

  const handleApplyDraft = async () => {
    // UI-only guardrail: do not call backend yet.
    setLastAction("Apply Draft is disabled until backend wiring is added.");
  };
'@

# Insert helpers before nudgedAt state line
$injectRegex = [regex]::Escape($anchorAfter)
$txt2 = $txt -replace $injectRegex, ($helpers.TrimEnd() + "`r`n" + $anchorAfter)
if($txt2 -eq $txt){ Fail "Helpers injection failed (no change)." }

# Anchor B: Fare card block currently present (from P6C)
$fareBlockAnchor = @'
              <div className="rounded border bg-white p-3">
                <div className="font-semibold">Fare</div>
                <div className="mt-1">
                  <div className="text-xs text-gray-500 mb-1">Proposed fare (draft)</div>
                  <input
                    value={proposedFareDraft}
                    onChange={(e) => setProposedFareDraft(e.target.value)}
                    placeholder="--"
                    className="w-full rounded border px-2 py-1 text-sm"
                    inputMode="decimal"
                  />
                  <div className="mt-1 text-[11px] text-gray-500">
                    UI-only draft. No backend update yet.
                  </div>
                </div>
              </div>
'@.Trim()

if($txt2.IndexOf($fareBlockAnchor) -lt 0){
  Fail "Fare card anchor block not found (P6C block changed). Cannot patch safely."
}

$fareReplacement = @'
              <div className="rounded border bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">Fare</div>
                    <div className="text-[11px] text-gray-500">Proposed fare (draft)</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                      onClick={handleCopyDraft}
                      disabled={!canCopyDraft}
                      title={canCopyDraft ? "Copy draft fare to clipboard" : "Enter a valid draft first"}
                    >
                      Copy
                    </button>

                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                      onClick={handleResetDraft}
                      disabled={!canResetDraft}
                      title={canResetDraft ? "Reset draft from selected trip" : "Select a trip first"}
                    >
                      Reset
                    </button>

                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
                      onClick={handleApplyDraft}
                      disabled={true}
                      title={applyDisabledReason}
                    >
                      Apply Draft
                    </button>
                  </div>
                </div>

                <div className="mt-2">
                  <input
                    value={proposedFareDraft}
                    onChange={(e) => setProposedFareDraft(e.target.value)}
                    placeholder="--"
                    className="w-full rounded border px-2 py-1 text-sm"
                    inputMode="decimal"
                  />
                  <div className="mt-1 text-[11px] text-gray-600">
                    {draftStatusText}
                  </div>
                </div>
              </div>
'@.Trim()

$txt3 = $txt2.Replace($fareBlockAnchor, $fareReplacement)
if($txt3 -eq $txt2){ Fail "Fare card replace failed (no change)." }

Set-Content -LiteralPath $target -Value $txt3 -Encoding UTF8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) Admin LiveTrips -> select a trip -> edit draft -> Copy/Reset work; Apply Draft stays disabled with tooltip"
