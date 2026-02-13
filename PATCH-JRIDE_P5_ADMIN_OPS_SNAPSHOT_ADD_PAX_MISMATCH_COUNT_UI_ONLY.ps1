# FIX-JRIDE_DRIVER_PAX_P6_HELPERS_REWRITE_SAFE.ps1
# Fix broken driver helpers boundaries after P6 injection by rewriting the entire PAX helpers block.
# Includes P6: paxSaving + try/finally (disable while saving handled separately; this fix focuses on syntax correctness).
# UTF-8 no BOM, ASCII-only, fail-fast.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function WriteUtf8NoBom($path, $content){
  $dir = Split-Path -Parent $path
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($content))
}

$root = (Get-Location).Path
$target = Join-Path $root "app\driver\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw -Encoding utf8
$orig = $txt

# 1) Ensure paxSaving state exists (right after paxPersistError if possible)
if ($txt -notmatch "paxSaving") {
  $anchor = 'const [paxPersistError, setPaxPersistError] = useState<string>("");'
  $i = $txt.IndexOf($anchor)
  if ($i -lt 0) { Fail "Anchor not found: paxPersistError state" }

  $add = @'
const [paxPersistError, setPaxPersistError] = useState<string>("");
  const [paxSaving, setPaxSaving] = useState<boolean>(false);
'@
  $txt = $txt.Replace($anchor, $add)
  Write-Host "[OK] Added paxSaving state"
} else {
  Write-Host "[OK] paxSaving already present (skip)"
}

# 2) Find start marker for helpers block
$startMarker1 = "// DRIVER_PAX_CONFIRM_P1_UI_ONLY helpers"
$startMarker2 = "// DRIVER_PAX_CONFIRM_P1_UI_ONLY"
$startIdx = $txt.IndexOf($startMarker1)
if ($startIdx -lt 0) { $startIdx = $txt.IndexOf($startMarker2) }
if ($startIdx -lt 0) { Fail "Could not find helpers start marker: DRIVER_PAX_CONFIRM_P1_UI_ONLY" }

# 3) End marker: function formatDate(
$endMarker = "function formatDate("
$endIdx = $txt.IndexOf($endMarker, $startIdx)
if ($endIdx -lt 0) { Fail "Could not find end marker: function formatDate(" }

$before = $txt.Substring(0, $startIdx)
$after  = $txt.Substring($endIdx)

# 4) New helpers block (safe, balanced braces)
$helpers = @'
  // DRIVER_PAX_CONFIRM_P6 helpers (safe rewrite)
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
    try { setPaxSaving(false); } catch {}
    setShowPaxConfirm(true);
  }

  async function confirmAndStartTrip() {
    if (!assigned) return;

    setPaxSaving(true);

    const booked = getBookedPax(assigned as any);
    const matches = paxMismatch ? false : true;

    const note = matches
      ? `PAX_MATCH booked=${booked}`
      : `PAX_MISMATCH booked=${booked} actual=${paxActual} reason=${paxReason}`;

    try {
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
    } finally {
      setPaxSaving(false);
    }
  }

'@

$txt2 = $before + $helpers + $after

if ($txt2 -eq $orig) { Fail "No changes applied (unexpected)" }

WriteUtf8NoBom $target $txt2
Write-Host "[OK] Rewrote helpers block safely: $target"

Write-Host ""
Write-Host "Now run:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Suggested commit/tag:"
Write-Host "  fix(driver): repair pax helpers after P6 injection"
Write-Host "  JRIDE_DRIVER_PAX_P6_HELPERS_FIX_GREEN"
