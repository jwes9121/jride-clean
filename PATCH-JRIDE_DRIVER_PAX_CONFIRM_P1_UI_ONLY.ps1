# PATCH-JRIDE_DRIVER_PAX_CONFIRM_P1_UI_ONLY.ps1
# UI-ONLY: Add driver passenger-count confirmation modal before Start Trip.

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

# ---------- Anchor A: inject new UI state after payouts state ----------
$anchorA = '  const [payouts, setPayouts] = useState<Payout[]>([]);'
if ($txt.IndexOf($anchorA) -lt 0) { Fail "AnchorA not found (payouts state)" }

$insertA = @'
  const [payouts, setPayouts] = useState<Payout[]>([]);

  // DRIVER_PAX_CONFIRM_P1_UI_ONLY
  const [showPaxConfirm, setShowPaxConfirm] = useState(false);
  const [paxMismatch, setPaxMismatch] = useState(false);
  const [paxActual, setPaxActual] = useState<string>("1");
  const [paxReason, setPaxReason] = useState<string>("added_passengers");
  const [paxLastNote, setPaxLastNote] = useState<string>("");
'@

$txt = $txt.Replace($anchorA, $insertA)

# ---------- Anchor B: inject helper functions before formatDate ----------
$anchorB = '  function formatDate(value: string | null) {'
if ($txt.IndexOf($anchorB) -lt 0) { Fail "AnchorB not found (formatDate)" }

$insertB = @'
  // DRIVER_PAX_CONFIRM_P1_UI_ONLY helpers (UI-only; no backend writes)
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
    setShowPaxConfirm(true);
  }

  async function confirmAndStartTrip() {
    if (!assigned) return;
    const booked = getBookedPax(assigned as any);
    const note = paxMismatch
      ? `PAX_MISMATCH booked=${booked} actual=${paxActual} reason=${paxReason}`
      : `PAX_MATCH booked=${booked}`;

    try {
      console.log("[JRide] driver pax confirm", { rideId: assigned.id, note });
    } catch {}

    setPaxLastNote(note);
    setShowPaxConfirm(false);

    // Continue existing flow (no API changes)
    await setStatus("in_progress");
  }

'@

$txt = $txt.Replace($anchorB, $insertB + $anchorB)

# ---------- Anchor C: replace Start button onClick to open modal ----------
$anchorC = '                onClick={() => setStatus("in_progress")}'
if ($txt.IndexOf($anchorC) -lt 0) { Fail "AnchorC not found (Start button onClick)" }

$txt = $txt.Replace($anchorC, '                onClick={() => openStartTripConfirm()}')

# ---------- Anchor D: inject modal JSX after the Start/Complete buttons row ----------
$anchorD = '            <div className="flex gap-2">'
if ($txt.IndexOf($anchorD) -lt 0) { Fail "AnchorD not found (buttons row div)" }

# We insert right after the closing </div> of the button row.
# Use a specific close anchor that exists in your file right after the two buttons.
$closeButtons = '            </div>'
$posRow = $txt.IndexOf($anchorD)
$posClose = $txt.IndexOf($closeButtons, $posRow)
if ($posClose -lt 0) { Fail "Could not locate closing </div> for buttons row" }

$insertD = @'
            </div>

            {/* DRIVER_PAX_CONFIRM_P1_UI_ONLY modal */}
            {showPaxConfirm ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl border border-black/10">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Passenger count confirmation</div>
                      <div className="mt-1 text-xs opacity-70">
                        Booked passengers: <span className="font-mono">{assigned ? getBookedPax(assigned as any) : "--"}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border px-2 py-1 text-xs hover:bg-black/5"
                      onClick={() => setShowPaxConfirm(false)}
                    >
                      Close
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    <button
                      type="button"
                      className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/5"
                      onClick={() => {
                        setPaxMismatch(false);
                        void confirmAndStartTrip();
                      }}
                    >
                      Confirm matches
                    </button>

                    <button
                      type="button"
                      className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm hover:bg-black/5"
                      onClick={() => setPaxMismatch(true)}
                    >
                      Does not match
                    </button>

                    {paxMismatch ? (
                      <div className="mt-2 rounded-xl border border-black/10 p-3 space-y-2">
                        <div className="text-xs font-semibold">Actual passengers</div>
                        <select
                          className="w-full rounded-lg border px-3 py-2 text-sm"
                          value={paxActual}
                          onChange={(e) => setPaxActual(e.target.value)}
                        >
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                          <option value="4+">4+</option>
                        </select>

                        <div className="text-xs font-semibold">Reason</div>
                        <select
                          className="w-full rounded-lg border px-3 py-2 text-sm"
                          value={paxReason}
                          onChange={(e) => setPaxReason(e.target.value)}
                        >
                          <option value="added_passengers">Added passengers</option>
                          <option value="less_passengers">Less passengers</option>
                          <option value="different_group">Different group</option>
                          <option value="other">Other</option>
                        </select>

                        <button
                          type="button"
                          className="mt-2 w-full rounded-xl bg-black text-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
                          onClick={() => void confirmAndStartTrip()}
                        >
                          Continue and start trip
                        </button>

                        <div className="text-[11px] opacity-70">
                          UI-only flag for admin review later. Does not change pricing yet.
                        </div>
                      </div>
                    ) : null}

                    {paxLastNote ? (
                      <div className="text-[11px] opacity-60">
                        Last note: <span className="font-mono">{paxLastNote}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {/* END DRIVER_PAX_CONFIRM_P1_UI_ONLY modal */}
'@

# Replace only the first occurrence of the closeButtons after the row start
$before = $txt.Substring(0, $posClose)
$after = $txt.Substring($posClose + $closeButtons.Length)
$txt = $before + $insertD + $after

Set-Content -Path $target -Value $txt -Encoding utf8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "Run build:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Suggested commit/tag:"
Write-Host "  feat(driver): pax confirmation before start trip (UI only)"
Write-Host "  JRIDE_DRIVER_PAX_CONFIRM_P1_UI_ONLY_GREEN"
