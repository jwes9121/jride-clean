# PATCH-JRIDE_P6G_ENABLE_APPLY_DRAFT_UI_V2.ps1
# P6G: Enable Apply Draft button and show computed summary after calling /api/admin/livetrips/apply-fare
# HARD RULES: DO_NOT_TOUCH_DISPATCH_STATUS, ANCHOR_BASED_ONLY, NO_DECLARE, NO_REDECLARE_NO_DECLARE

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$uiFile = Join-Path $root 'app\admin\livetrips\LiveTripsClient.tsx'
if(!(Test-Path $uiFile)){ Fail "UI file not found: $uiFile" }

$ui = Get-Content -LiteralPath $uiFile -Raw -Encoding UTF8

# Anchors (must exist)
if($ui.IndexOf('proposedFareDraft') -lt 0){ Fail "Anchor not found: proposedFareDraft" }
if($ui.IndexOf('setLastAction') -lt 0){ Fail "Anchor not found: setLastAction" }
if($ui.IndexOf('loadPage') -lt 0){ Fail "Anchor not found: loadPage" }
if($ui.IndexOf('Apply Draft') -lt 0){ Fail "Anchor not found: Apply Draft" }

# Do not double-enable
if($ui.IndexOf('fetch("/api/admin/livetrips/apply-fare"') -ge 0){
  Fail "Apply Draft already enabled (found apply-fare fetch). Aborting to avoid duplicates."
}

# Backup
$bak = "$uiFile.bak.$(Stamp)"
Copy-Item -LiteralPath $uiFile -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

# Find the disabled Apply Draft button block structurally and replace it.
# We capture the className so we preserve your styling exactly.
$pat = '(?s)<button\s*\r?\n\s*type="button"\s*\r?\n\s*className="([^"]+)"\s*\r?\n\s*onClick=\{\(\) => setLastAction\("Apply Draft is disabled until backend wiring is added\."\)\}\s*\r?\n\s*disabled=\{true\}\s*\r?\n\s*title="([^"]*)"\s*\r?\n\s*>\s*\r?\n\s*Apply Draft\s*\r?\n\s*</button>'

$replaced = $false

$ui2 = [regex]::Replace($ui, $pat, {
  param($m)
  $replaced = $true
  $cls = $m.Groups[1].Value

  @"
<button
        type="button"
        className="$cls"
        onClick={async () => {
          if (!selectedTrip) {
            setLastAction("Select a trip first.");
            return;
          }

          const code = String((selectedTrip as any)?.booking_code ?? "").trim();
          if (!code) {
            setLastAction("Missing booking_code on selected trip.");
            return;
          }

          const raw = String(proposedFareDraft ?? "").trim();
          const fare = Number(raw);
          if (!raw || !Number.isFinite(fare) || fare <= 0) {
            setLastAction("Invalid draft fare (must be a number > 0).");
            return;
          }

          try {
            setLastAction("Applying draft fare...");
            const res = await fetch("/api/admin/livetrips/apply-fare", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ booking_code: code, fare }),
            });

            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.ok) {
              const c = String(json?.code || "FAILED");
              const msg = String(json?.message || "");
              throw new Error(msg ? (c + " - " + msg) : c);
            }

            const comp = json?.computed || null;
            const applied = Array.isArray(json?.applied_computed_fields) ? json.applied_computed_fields : [];
            const note = String(json?.note || "");
            const af = String(json?.applied_field || "");

            const parts: string[] = [];
            if (af) parts.push("fare→" + af);
            if (comp && typeof comp === "object") {
              if (typeof comp.total_to_pay !== "undefined") parts.push("total_to_pay=" + String(comp.total_to_pay));
              if (typeof comp.company_cut !== "undefined") parts.push("company_cut=" + String(comp.company_cut));
              if (typeof comp.driver_payout !== "undefined") parts.push("driver_payout=" + String(comp.driver_payout));
            }
            if (applied.length) parts.push("updated: " + applied.join(", "));
            if (note) parts.push(note);

            setLastAction("Applied. " + parts.join(" | "));
            await loadPage();
          } catch (e: any) {
            setLastAction("Apply failed: " + String(e?.message || e));
          }
        }}
        disabled={false}
        title="Apply draft fare to booking (admin)"
      >
        Apply Draft
      </button>
"@
}, 1)

if(-not $replaced){
  Fail "Could not find the disabled Apply Draft button block to replace (anchor mismatch)."
}

Set-Content -LiteralPath $uiFile -Value $ui2 -Encoding UTF8
Write-Host "[OK] Patched: $uiFile"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) Admin LiveTrips -> set draft -> Apply Draft -> expect computed summary in lastAction"
