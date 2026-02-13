# PATCH-JRIDE_PASSENGER_P4A_P4B_FARE_OFFER_PICKUP_DISTANCE_FEE_V3.ps1
# P4A + P4B: Passenger UI fare-offer panel + pickup distance fee + platform fee + accept/reject payload fields
# Anchor-based edits only (regex). No schema changes. Touches ONLY app/ride/page.tsx.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m) { Write-Host $m -ForegroundColor Green }

$ROOT = (Get-Location).Path
$RidePage = Join-Path $ROOT 'app\ride\page.tsx'
if (!(Test-Path $RidePage)) { Fail "Missing file: $RidePage" }

# --- backup ---
$ts = (Get-Date).ToString('yyyyMMdd_HHmmss')
Copy-Item $RidePage ($RidePage + '.bak.' + $ts) -Force
Ok "[OK] Backup: $RidePage.bak.$ts"

$txt = Get-Content -LiteralPath $RidePage -Raw
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# -------------------------
# 1) Add liveBooking + fareBusy states
# Insert after liveErr state line.
# -------------------------
if ($txt -notmatch 'const\s+\[liveBooking,\s*setLiveBooking\]') {
  $reLiveErr = [regex]::new('(?m)^(?<indent>\s*)const\s+\[liveErr,\s*setLiveErr\]\s*=\s*React\.useState<[^>]*>\(""\);\s*$')
  if (-not $reLiveErr.IsMatch($txt)) { Fail "Anchor not found: liveErr state line" }

  $txt = $reLiveErr.Replace($txt, {
    param($m)
    $i = $m.Groups['indent'].Value
    return $m.Value + "`r`n" + $i + 'const [liveBooking, setLiveBooking] = React.useState<any | null>(null); // P4A/P4B'
  }, 1)
  Ok "[OK] Inserted liveBooking state"
} else {
  Info "[SKIP] liveBooking already present"
}

if ($txt -notmatch 'const\s+\[fareBusy,\s*setFareBusy\]') {
  # Prefer insert after liveBooking line if present, else after liveErr
  $reLiveBookingLine = [regex]::new('(?m)^(?<indent>\s*)const\s+\[liveBooking,\s*setLiveBooking\]\s*=\s*React\.useState<[^>]*>\(null\);\s*//\s*P4A/P4B\s*$')
  if ($reLiveBookingLine.IsMatch($txt)) {
    $txt = $reLiveBookingLine.Replace($txt, {
      param($m)
      $i = $m.Groups['indent'].Value
      return $m.Value + "`r`n" + $i + 'const [fareBusy, setFareBusy] = React.useState<boolean>(false); // P4A/P4B'
    }, 1)
  } else {
    $reLiveErr = [regex]::new('(?m)^(?<indent>\s*)const\s+\[liveErr,\s*setLiveErr\]\s*=\s*React\.useState<[^>]*>\(""\);\s*$')
    if (-not $reLiveErr.IsMatch($txt)) { Fail "Anchor not found: liveErr state line (fareBusy fallback)" }
    $txt = $reLiveErr.Replace($txt, {
      param($m)
      $i = $m.Groups['indent'].Value
      return $m.Value + "`r`n" + $i + 'const [fareBusy, setFareBusy] = React.useState<boolean>(false); // P4A/P4B'
    }, 1)
  }
  Ok "[OK] Inserted fareBusy state"
} else {
  Info "[SKIP] fareBusy already present"
}

# -------------------------
# 2) In polling tick, capture booking into liveBooking
# Insert after the booking parse line.
# -------------------------
if ($txt -notmatch 'setLiveBooking\(') {
  $reB = [regex]::new('(?m)^(?<indent>\s*)const\s+b\s*=\s*\(j\.booking\s*\|\|\s*\(j\.data\s*&&\s*j\.data\.booking\)\s*\|\|\s*\(j\.payload\s*&&\s*j\.payload\.booking\)\s*\|\|\s*j\)\s*as\s*any;\s*$')
  if (-not $reB.IsMatch($txt)) { Fail "Anchor not found: booking parse line (const b = (j.booking || ... ) as any;)" }

  $txt = $reB.Replace($txt, {
    param($m)
    $i = $m.Groups['indent'].Value
    return $m.Value + "`r`n" + $i + 'try { setLiveBooking(b); } catch {}'
  }, 1)
  Ok "[OK] Inserted setLiveBooking(b)"
} else {
  Info "[SKIP] setLiveBooking already present"
}

# -------------------------
# 3) Add P4 helpers after p1FriendlyError() function block (first occurrence)
# -------------------------
if ($txt -notmatch 'P4_PLATFORM_SERVICE_FEE') {
  $reC = [regex]::new('function\s+p1FriendlyError\s*\([\s\S]*?\r?\n\}\r?\n', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $m = $reC.Match($txt)
  if (-not $m.Success) { Fail "Anchor not found: function p1FriendlyError(...) block" }

  $helpers = @"
$m

/* ===== JRIDE P4A+P4B: Fare Offer + Pickup Distance Fee (UI-only helpers) ===== */
const P4_PLATFORM_SERVICE_FEE = 15;

function p4Num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function p4Money(n: any): string {
  const x = p4Num(n);
  if (x == null) return "—";
  try { return "₱" + x.toFixed(0); } catch { return "₱" + String(x); }
}

// Pickup Distance Fee rule (FINAL):
// Free pickup: up to 1.5 km
// If driver->pickup distance > 1.5 km:
// Base pickup fee: ₱20
// ₱10 per additional 0.5 km, rounded up
function p4PickupDistanceFee(driverToPickupKmAny: any): number {
  const km = p4Num(driverToPickupKmAny);
  if (km == null) return 0;
  if (km <= 1.5) return 0;
  const base = 20;
  const extraKm = Math.max(0, km - 1.5);
  const blocks = Math.ceil(extraKm / 0.5);
  return base + Math.max(0, blocks - 1) * 10;
}
/* ===== END JRIDE P4A+P4B HELPERS ===== */

"@

  # replace only first match by manual splice
  $start = $m.Index
  $len = $m.Length
  $before = $txt.Substring(0, $start)
  $after  = $txt.Substring($start + $len)
  $txt = $before + $helpers + $after

  Ok "[OK] Inserted P4 helpers after p1FriendlyError()"
} else {
  Info "[SKIP] P4 helpers already present"
}

# -------------------------
# 4) Inject Fare Offer panel into Trip status card:
# After the code: <span ...>{activeCode}</span> block and before the next <div className="mt-2">
# -------------------------
if ($txt -notmatch 'JRIDE P4A\+P4B: Fare Offer') {
  $reD = [regex]::new('(<div className="mt-1 text-xs font-mono">[\s\S]*?code:\s*<span className="font-semibold">\{activeCode\}<\/span>[\s\S]*?<\/div>\s*\r?\n\s*)(<div className="mt-2">)', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $mD = $reD.Match($txt)
  if (-not $mD.Success) { Fail "Anchor not found: activeCode code line block before mt-2 section" }

  $panel = @"
$($mD.Groups[1].Value)
            {/* ===== JRIDE P4A+P4B: Fare Offer + Fees breakdown (UI-only) ===== */}
            {(() => {
              const b: any = liveBooking || null;

              const proposed =
                p4Num(b?.proposed_fare) ??
                p4Num(b?.proposedFare) ??
                p4Num(b?.fare_proposed) ??
                p4Num(b?.fare) ??
                null;

              // driver -> pickup distance (FINAL). Prefer driver_distance_km; fallback cautiously.
              const driverKm =
                p4Num(b?.driver_distance_km) ??
                p4Num(b?.driverDistanceKm) ??
                p4Num(b?.pickup_distance_km) ??
                p4Num(b?.pickupDistanceKm) ??
                p4Num(b?.distance_km) ??
                p4Num(b?.distanceKm) ??
                null;

              const resp = String(b?.passenger_fare_response || b?.passengerFareResponse || "").toLowerCase();
              const st = String(b?.status || liveStatus || "").toLowerCase();
              const terminal = st === "completed" || st === "cancelled";

              // Show when there's a driver offer and passenger hasn't accepted yet
              const show = !terminal && proposed != null && proposed > 0 && resp !== "accepted";
              if (!show) return null;

              const pickupFee = p4PickupDistanceFee(driverKm);
              const platformFee = P4_PLATFORM_SERVICE_FEE;
              const total = (proposed || 0) + pickupFee + platformFee;

              return (
                <div className="mt-3 rounded-2xl border border-black/10 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Fare offer</div>
                      <div className="mt-1 text-xs opacity-70">
                        Review the driver’s offer and fees before accepting.
                      </div>
                    </div>
                    <div className="text-xs rounded-full bg-slate-900 text-white px-3 py-1 font-semibold">
                      Awaiting your response
                    </div>
                  </div>

                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">Fare (Driver Offer)</div>
                      <div className="font-semibold">{p4Money(proposed)}</div>
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">Pickup Distance Fee</div>
                        <div className="text-xs opacity-70">
                          Free pickup within 1.5 km. Additional fee applies if driver is farther.
                        </div>
                        {driverKm != null ? (
                          <div className="mt-1 text-[11px] font-mono opacity-60">
                            driver → pickup: {driverKm.toFixed(2)} km
                          </div>
                        ) : null}
                      </div>
                      <div className="font-semibold">{p4Money(pickupFee)}</div>
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">Platform Service Fee</div>
                        <div className="text-xs opacity-70">
                          Supports app operations, customer support, and safety features.
                        </div>
                      </div>
                      <div className="font-semibold">{p4Money(platformFee)}</div>
                    </div>

                    <div className="mt-2 border-t border-black/10 pt-2 flex items-center justify-between">
                      <div className="font-semibold">Total to Pay</div>
                      <div className="text-base font-bold">{p4Money(total)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={fareBusy || busy}
                      className="rounded-xl bg-emerald-600 text-white px-5 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                      onClick={async () => {
                        try {
                          setFareBusy(true);
                          setResult("");

                          const code = String(activeCode || "").trim();
                          const payload = {
                            bookingCode: code,
                            response: "accepted",
                            proposed_fare: proposed,
                            pickup_distance_fee: pickupFee,
                            platform_service_fee: platformFee,
                            total_to_pay: total,
                          };

                          const r = await postJson("/api/rides/fare-response", payload);
                          if (!r.ok) {
                            const msg = (r.json && (r.json.error || r.json.message)) ? String(r.json.error || r.json.message) : ("HTTP " + String(r.status));
                            setResult("FARE_RESPONSE_FAILED: " + msg);
                            return;
                          }

                          setResult("Fare accepted. Proceeding...");
                        } catch (e: any) {
                          setResult("FARE_ACCEPT_ERROR: " + String(e?.message || e));
                        } finally {
                          setFareBusy(false);
                        }
                      }}
                    >
                      {fareBusy ? "Accepting..." : "Accept"}
                    </button>

                    <button
                      type="button"
                      disabled={fareBusy || busy}
                      className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                      onClick={async () => {
                        try {
                          setFareBusy(true);
                          setResult("");

                          const code = String(activeCode || "").trim();
                          const payload = {
                            bookingCode: code,
                            response: "rejected",
                            proposed_fare: proposed,
                            pickup_distance_fee: pickupFee,
                            platform_service_fee: platformFee,
                            total_to_pay: total,
                          };

                          const r = await postJson("/api/rides/fare-response", payload);
                          if (!r.ok) {
                            const msg = (r.json && (r.json.error || r.json.message)) ? String(r.json.error || r.json.message) : ("HTTP " + String(r.status));
                            setResult("FARE_RESPONSE_FAILED: " + msg);
                            return;
                          }

                          setResult("Fare rejected. Requesting another driver quote...");
                        } catch (e: any) {
                          setResult("FARE_REJECT_ERROR: " + String(e?.message || e));
                        } finally {
                          setFareBusy(false);
                        }
                      }}
                    >
                      {fareBusy ? "Rejecting..." : "Reject"}
                    </button>
                  </div>
                </div>
              );
            })()}
            {/* ===== END JRIDE P4A+P4B ===== */}

$($mD.Groups[2].Value)
"@

  $txt = $reD.Replace($txt, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $panel }, 1)
  Ok "[OK] Inserted Fare Offer panel"
} else {
  Info "[SKIP] Fare Offer panel already present"
}

# -------------------------
# 5) Clear blocks: after setLiveErr(""), add setLiveBooking(null) if missing (best-effort)
# -------------------------
$reClr = [regex]::new('setActiveCode\(""\);\s*\r?\n\s*setLiveStatus\(""\);\s*\r?\n\s*setLiveDriverId\(""\);\s*\r?\n\s*setLiveUpdatedAt\(null\);\s*\r?\n\s*setLiveErr\(""\);\s*', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if ($reClr.IsMatch($txt)) {
  $txt = $reClr.Replace($txt, {
    param($m)
    if ($m.Value -match 'setLiveBooking') { return $m.Value }
    return $m.Value + "`r`n              try { setLiveBooking(null); } catch {}" + "`r`n"
  }, 10)
  Ok "[OK] Updated clear/reset blocks to clear liveBooking"
} else {
  Info "[WARN] Clear/reset block anchor not found (non-fatal)"
}

# Write patched file
[System.IO.File]::WriteAllText($RidePage, $txt, $Utf8NoBom)
Ok "[OK] Patched: app/ride/page.tsx"
Ok "DONE. Next: run build."
