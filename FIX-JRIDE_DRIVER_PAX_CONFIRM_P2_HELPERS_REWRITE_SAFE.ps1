# FIX-JRIDE_DRIVER_PAX_CONFIRM_P2_HELPERS_REWRITE_SAFE.ps1
# Fix broken function boundaries from P2 by rewriting the entire DRIVER_PAX_CONFIRM helpers block.
# Keeps existing UI modal + Start button wiring. Does NOT touch backend logic beyond pax-confirm fetch already intended.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\driver\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw -Encoding utf8

# --- Ensure paxPersistError state exists (right after paxLastNote) ---
$stateAnchor = 'const [paxLastNote, setPaxLastNote] = useState<string>("");'
if ($txt.IndexOf($stateAnchor) -lt 0) {
  Fail "State anchor not found: paxLastNote"
}
if ($txt -notmatch "paxPersistError") {
  $stateLine = '  const [paxPersistError, setPaxPersistError] = useState<string>("");'
  $txt = $txt.Replace($stateAnchor, ($stateAnchor + "`r`n" + $stateLine))
  Write-Host "[OK] Added paxPersistError state"
} else {
  Write-Host "[OK] paxPersistError state already present (skip)"
}

# --- Replace helpers block between markers ---
$startMarker = "// DRIVER_PAX_CONFIRM_P1_UI_ONLY helpers"
$altStartMarker = "// DRIVER_PAX_CONFIRM_P1_UI_ONLY"

$startIdx = $txt.IndexOf($startMarker)
if ($startIdx -lt 0) { $startIdx = $txt.IndexOf($altStartMarker) }
if ($startIdx -lt 0) { Fail "Could not find helpers start marker (DRIVER_PAX_CONFIRM_P1_UI_ONLY)" }

$endMarker = "function formatDate("
$endIdx = $txt.IndexOf($endMarker, $startIdx)
if ($endIdx -lt 0) { Fail "Could not find end marker: function formatDate(" }

$before = $txt.Substring(0, $startIdx)
$after  = $txt.Substring($endIdx)

$helpers = @'
  // DRIVER_PAX_CONFIRM_P2_PERSIST helpers (safe rewrite)
  function getBookedPax(r: any): string {
    const v =
      (r && (r.passenger_count ?? r.passengers ?? r.pax ?? r.pax_count ?? r.seats ?? r.num_passengers)) as any;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return String(Math.round(n));
    const s = String(v ?? "").trim();
    return s ? s : "--";
  }

  function openStartTripConfirm() {
    if (!assigned) return;
    setPaxMismatch(false);
    setPaxActual("1");
    setPaxReason("added_passengers");
    try { setPaxPersistError(""); } catch {}
    setShowPaxConfirm(true);
  }

  async function confirmAndStartTrip() {
    if (!assigned) return;

    const booked = getBookedPax(assigned as any);
    const matches = paxMismatch ? false : true;

    const note = matches
      ? `PAX_MATCH booked=${booked}`
      : `PAX_MISMATCH booked=${booked} actual=${paxActual} reason=${paxReason}`;

    // Non-blocking persist (P2)
    try {
      setPaxPersistError("");

      const rideId = (assigned as any)?.id ?? null;
      const driverId =
        (assigned as any)?.driver_id ??
        (assigned as any)?.driverId ??
        null;

      const res = await fetch("/api/driver/pax-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ride_id: rideId,
          driver_id: driverId,
          matches,
          booked_pax: booked,
          actual_pax: matches ? null : paxActual,
          reason: matches ? null : paxReason,
          note,
        }),
      });

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.ok) {
        const msg = String(j?.error || "PAX_CONFIRM_SAVE_FAILED");
        setPaxPersistError(msg);
      }
    } catch (e: any) {
      try { setPaxPersistError(String(e?.message || "PAX_CONFIRM_SAVE_FAILED")); } catch {}
    }

    try { setPaxLastNote(note); } catch {}
    setShowPaxConfirm(false);

    // Continue existing flow (status update remains unchanged)
    await setStatus("in_progress");
  }

'@

$txt2 = $before + $helpers + $after

Set-Content -Path $target -Value $txt2 -Encoding utf8
Write-Host "[OK] Rewrote helpers block safely: $target"

Write-Host ""
Write-Host "Now run:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Suggested commit/tag:"
Write-Host "  fix(driver): repair pax confirm helpers boundary (P2)"
Write-Host "  JRIDE_DRIVER_PAX_CONFIRM_P2_FIX_GREEN"
