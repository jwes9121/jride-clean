# PATCH-JRIDE_P6D_UI_APPLY_DRAFT_GUARDED_V4.ps1
# P6D_V4: UI-only - Add Copy/Reset/Apply-disabled + inline status inside the existing Fare card JSX
# HARD RULES: ANCHOR_BASED_ONLY, NO_DECLARE, NO_REDECLARE_NO_DECLARE, DO_NOT_TOUCH_DISPATCH_STATUS

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$target = Join-Path $root 'app\admin\livetrips\LiveTripsClient.tsx'
if(!(Test-Path $target)){ Fail "Target not found: $target" }

$txt = Get-Content -LiteralPath $target -Raw -Encoding UTF8

# Anchor: must already have the P6C draft input in Fare card
if($txt.IndexOf('Proposed fare (draft)') -lt 0){ Fail "Anchor not found: Proposed fare (draft)" }
if($txt.IndexOf('value={proposedFareDraft}') -lt 0){ Fail "Anchor not found: value={proposedFareDraft}" }
if($txt.IndexOf('setProposedFareDraft') -lt 0){ Fail "Anchor not found: setProposedFareDraft" }
if($txt.IndexOf('setLastAction') -lt 0){ Fail "Anchor not found: setLastAction" }
if($txt.IndexOf('selectedTrip') -lt 0){ Fail "Anchor not found: selectedTrip" }

# Backup
$bak = "$target.bak.$(Stamp)"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

# Replace the entire Fare card JSX block that contains proposedFareDraft input.
# Structural anchor: a card div that includes Proposed fare (draft) + proposedFareDraft input.
$fareRegex = '(?s)<div className="rounded border bg-white p-3">\s*<div className="font-semibold">Fare</div>.*?Proposed fare \(draft\).*?value=\{proposedFareDraft\}.*?UI-only draft\.\s*No backend update yet\..*?</div>\s*</div>\s*</div>'
if(-not [regex]::IsMatch($txt, $fareRegex)){
  # fallback: same but without the exact UI-only sentence
  $fareRegex = '(?s)<div className="rounded border bg-white p-3">\s*<div className="font-semibold">Fare</div>.*?Proposed fare \(draft\).*?value=\{proposedFareDraft\}.*?</div>\s*</div>\s*</div>'
  if(-not [regex]::IsMatch($txt, $fareRegex)){
    Fail "Fare card structural anchor not found (expected rounded card containing Proposed fare (draft) + proposedFareDraft input)."
  }
}

# Replacement keeps everything self-contained in JSX (no new const injections)
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
        onClick={async () => {
          const raw = String(proposedFareDraft ?? "").trim();
          const n = Number(raw);
          if (!raw || !Number.isFinite(n) || n <= 0) {
            setLastAction("Copy failed: draft must be a number > 0.");
            return;
          }
          try {
            if (navigator && (navigator as any).clipboard && (navigator as any).clipboard.writeText) {
              await (navigator as any).clipboard.writeText(String(n));
              setLastAction("Copied Proposed Fare (draft) to clipboard.");
            } else {
              setLastAction("Clipboard unavailable in this browser.");
            }
          } catch {
            setLastAction("Copy failed.");
          }
        }}
        disabled={(() => {
          const raw = String(proposedFareDraft ?? "").trim();
          const n = Number(raw);
          return !raw || !Number.isFinite(n) || n <= 0;
        })()}
        title={(() => {
          const raw = String(proposedFareDraft ?? "").trim();
          const n = Number(raw);
          return (!raw || !Number.isFinite(n) || n <= 0) ? "Enter a valid draft first" : "Copy draft fare to clipboard";
        })()}
      >
        Copy
      </button>

      <button
        type="button"
        className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
        onClick={() => {
          if (!selectedTrip) {
            setLastAction("Reset skipped: select a trip first.");
            return;
          }
          const v =
            (selectedTrip as any)?.proposed_fare ??
            (selectedTrip as any)?.proposedFare ??
            (selectedTrip as any)?.verified_fare ??
            (selectedTrip as any)?.verifiedFare ??
            null;

          const n = Number(v);
          if (Number.isFinite(n) && n > 0) setProposedFareDraft(String(n));
          else setProposedFareDraft("");

          setLastAction("Reset Proposed Fare (draft) from selected trip.");
        }}
        disabled={!selectedTrip}
        title={selectedTrip ? "Reset draft from selected trip" : "Select a trip first"}
      >
        Reset
      </button>

      <button
        type="button"
        className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-50"
        onClick={() => setLastAction("Apply Draft is disabled until backend wiring is added.")}
        disabled={true}
        title="Backend apply is not wired yet (UI-only draft)."
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
      {(() => {
        if (!selectedTrip) return "Select a trip to edit draft.";
        const raw = String(proposedFareDraft ?? "").trim();
        if (!raw) return "Draft is empty.";
        const dn = Number(raw);
        if (!Number.isFinite(dn) || dn <= 0) return "Draft invalid (must be a number > 0).";

        const v =
          (selectedTrip as any)?.proposed_fare ??
          (selectedTrip as any)?.proposedFare ??
          (selectedTrip as any)?.verified_fare ??
          (selectedTrip as any)?.verifiedFare ??
          null;

        const tn = Number(v);
        if (Number.isFinite(tn) && tn > 0 && Math.abs(dn - tn) < 0.0001) return "No changes vs current trip fare.";
        return "Draft ready (UI-only).";
      })()}
    </div>
  </div>
</div>
'@.Trim()

$txt2 = [regex]::Replace($txt, $fareRegex, $fareReplacement, 1)
if($txt2 -eq $txt){ Fail "Fare card replace failed (no change)." }

Set-Content -LiteralPath $target -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) Admin LiveTrips -> select trip -> draft -> Copy/Reset work; Apply Draft stays disabled with tooltip"
