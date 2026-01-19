"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser;

type Ride = {
  id: string;
  status: string;
  pickup_lat: number;
  pickup_lng: number;
  town?: string | null;
  driver_id?: string | null;
  created_at?: string | null;
};

type WalletStatus = {
  driver_id: string;
  wallet_balance: number;
  min_wallet_required: number;
  wallet_status: string | null;
  can_accept_new_jobs: boolean | null;
};

type Payout = {
  id: number;
  amount: number;
  status: string;
  requested_at: string;
  processed_at: string | null;
  payout_method: string | null;
  payout_reference: string | null;
};

export default function DriverDashboard() {
  // Put your test driver UUID here (from drivers table)
  const [driverId, setDriverId] = useState<string>(
    "7d45e50c-3d76-4aa6-ac22-abb4538859ca"
  );

  
  // PHASE13-D_DRIVER_GEO_GATE
  function inIfugaoBBox(lat: number, lng: number): boolean {
    // Conservative bbox, same as passenger gate
    return lat >= 16.5 && lat <= 17.2 && lng >= 120.8 && lng <= 121.4;
  }

  const [geoPermission, setGeoPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [geoInsideIfugao, setGeoInsideIfugao] = useState<boolean | null>(null);
  const [geoErr, setGeoErr] = useState<string>("");

  // Must be called directly from a click handler on mobile browsers
  function promptDriverGeoFromClick() {
    setGeoErr("");

    try {
      const anyGeo: any = (navigator as any)?.geolocation;
      if (!anyGeo || !anyGeo.getCurrentPosition) {
        setGeoPermission("denied");
        setGeoInsideIfugao(null);
        setGeoErr("Geolocation not available.");
        return;
      }

      const ua = String((navigator as any)?.userAgent || "");
      const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);

      anyGeo.getCurrentPosition(
        (pos: any) => {
          const lat = Number(pos?.coords?.latitude);
          const lng = Number(pos?.coords?.longitude);

          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            setGeoPermission("unknown");
            setGeoInsideIfugao(null);
            setGeoErr("Could not read coordinates.");
            return;
          }

          setGeoPermission("granted");
          setGeoInsideIfugao(inIfugaoBBox(lat, lng));
        },
        (err: any) => {
          const code = Number(err?.code || 0);
          const msg = String(err?.message || err || "");
          setGeoInsideIfugao(null);

          if (code === 1) {
            setGeoPermission("denied");
            setGeoErr("Location permission denied.");
          } else {
            setGeoPermission("unknown");
            setGeoErr(msg ? ("Location error: " + msg) : "Location error.");
          }
        },
        {
          enableHighAccuracy: isMobile ? true : true,
          timeout: isMobile ? 15000 : 10000,
          maximumAge: 0,
        }
      );
    } catch (e: any) {
      setGeoPermission("unknown");
      setGeoInsideIfugao(null);
      setGeoErr("Location check failed.");
    }
  }

  const driverGeoOk = geoPermission === "granted" && geoInsideIfugao === true;
const [assigned, setAssigned] = useState<Ride | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);

  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);

    // DRIVER_PAX_CONFIRM_P3_P6 block (safe rewrite)
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

  // P3: load latest persisted pax confirmation (read-only)
  useEffect(() => {
    (async () => {
      try {
        setPaxLatestErr("");
        const rideId = (assigned as any)?.id;
        if (!rideId) { setPaxLatest(null); return; }

        const res = await fetch(`/api/driver/pax-confirm/latest?ride_id=${encodeURIComponent(String(rideId))}`);
        const j = await res.json().catch(() => ({} as any));
        if (!res.ok || !j?.ok) {
          setPaxLatest(null);
          setPaxLatestErr(String(j?.error || "PAX_LATEST_LOAD_FAILED"));
          return;
        }
        setPaxLatest(j.row || null);
      } catch (e: any) {
        setPaxLatest(null);
        setPaxLatestErr(String(e?.message || "PAX_LATEST_LOAD_FAILED"));
      }
    })();
  }, [(assigned as any)?.id]);

  // P6: confirm and start with saving state + try/finally
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
function formatDate(value: string | null) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  }

  return (
    <div className="p-6 max-w-xl space-y-4">
      {/* P3 PAX badge (read-only) */}
      {assigned ? (
        <div className="mb-3 rounded-2xl border border-black/10 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs opacity-70">
              Booked pax: <span className="font-mono">{getBookedPax(assigned as any)}</span>
            </div>

            {paxLatest ? (
              <div className="flex items-center gap-2">
                {paxLatest.matches === false ? (
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                    PAX mismatch reported
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                    PAX confirmed
                  </span>
                )}
                <span className="text-[11px] opacity-60">
                  {paxLatest.created_at ? String(paxLatest.created_at) : ""}
                </span>
              </div>
            ) : paxLatestErr ? (
              <div className="text-[11px] text-rose-700">PAX status unavailable</div>
            ) : (
              <div className="text-[11px] opacity-60">No confirmation yet</div>
            )}
          </div>
        </div>
      ) : null}
      {/* END P3 PAX badge */}
      <h1 className="text-xl font-semibold">JRide • Driver</h1>
      {/* PHASE13-D_DRIVER_GEO_GATE_UI_PANEL */}
      <div className="mt-3 border rounded-2xl p-3 bg-amber-50 border-amber-300 space-y-2">
        <div className="font-medium text-amber-900">Driver location check</div>
        <div className="text-xs text-amber-900/80">
          Permission: {geoPermission} | Inside Ifugao: {String(geoInsideIfugao)}
        </div>
        {geoErr ? <div className="text-xs text-red-700">{geoErr}</div> : null}
        <button
          type="button"
          className="border rounded px-3 py-2 bg-amber-900 text-white"
          onClick={() => promptDriverGeoFromClick()}
        >
          {geoPermission === "granted" ? "Re-check location" : "Enable location"}
        </button>
      </div>
      {/* END PHASE13-D_DRIVER_GEO_GATE_UI_PANEL */}

{/* Driver config + shift controls */}
      <div className="space-y-2 border rounded-2xl p-3">
        <label className="text-sm">Driver UUID</label>
        <input
          className="border rounded px-3 py-2 w-full"
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="border rounded px-3 py-2"
            onClick={startSharing}
            disabled={watchId !== null}
          >
            Start shift
          </button>
          <button
            className="border rounded px-3 py-2"
            onClick={stopSharing}
            disabled={watchId === null}
          >
            Stop shift
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={available}
              onChange={(e) => {
                const next = e.target.checked;
                if (next && locked) {
                  alert(
                    "You cannot mark yourself as available because your JRide wallet is below the minimum required load."
                  );
                  return;
                }
                setAvailable(next);
              }}
            />
            Available
          </label>
        </div>
        <div className="text-xs opacity-60">
          Sends GPS → <code>/api/driver/heartbeat</code> → live on map.
        </div>
      </div>

      {/* Wallet status (auto-lock info) */}
      <div className="space-y-1 border rounded-2xl p-3">
        <div className="font-medium">Wallet status</div>
        {wallet ? (
          <>
            <div className="text-sm">
              Balance:{" "}
              <span className="font-semibold">
                ₱{wallet.wallet_balance.toFixed(2)}
              </span>{" "}
              <span className="text-xs text-gray-600">
                (min ₱{wallet.min_wallet_required.toFixed(2)})
              </span>
            </div>
            <div className="text-xs">
              {wallet.can_accept_new_jobs
                ? "You can accept new jobs."
                : "You cannot accept new jobs until you top up your JRide wallet."}
            </div>
          </>
        ) : (
          <div className="text-sm opacity-70">
            No wallet record yet for this driver.
          </div>
        )}
      </div>

      {/* Current ride */}
      <div className="space-y-2 border rounded-2xl p-3">
        <div className="font-medium">Current Ride</div>
        {assigned ? (
          <div className="text-sm space-y-2">
            <div>ID: {assigned.id}</div>
            <div>
              Status: <b>{assigned.status}</b>
            </div>
            <div>
              Pickup: {assigned.pickup_lat?.toFixed(5)},{" "}
              {assigned.pickup_lng?.toFixed(5)}
            </div>
            <div className="flex gap-2">
              <button
                className="border rounded px-3 py-2"
                onClick={() => openStartTripConfirm()}
                disabled={assigned.status !== "assigned"}
              >
                Start
              </button>
              <button
                className="border rounded px-3 py-2"
                onClick={() => setStatus("completed")}
                disabled={assigned.status !== "in_progress"}
              >
                Complete
              </button>
            </div>

            {/* DRIVER_PAX_CONFIRM_P1_UI_ONLY modal */}
            {showPaxConfirm ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl border border-black/10">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Confirm passenger count</div>
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
                      disabled={paxSaving} onClick={() => {
                        setPaxMismatch(false);
                        void confirmAndStartTrip();
                      }}
                    >
                      {paxSaving ? "Starting..." : "Confirm matches"}
                    </button>

                    <button
                      type="button"
                      className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm hover:bg-black/5" onClick={() => setPaxMismatch(true)}
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
                          disabled={paxSaving} onClick={() => void confirmAndStartTrip()}
                        >
                          {paxSaving ? "Starting..." : "Continue and start trip"}
                        </button>

                        <div className="text-[11px] opacity-70">
                          UI-only flag for admin review later. Does not change pricing yet.
                          {paxPersistError ? (
                            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-800">
                              Save failed (non-blocking): <span className="font-mono">{paxPersistError}</span>
                            </div>
                          ) : null}
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
          </div>
        ) : (
          <div className="text-sm opacity-70">No assigned ride.</div>
        )}
      </div>

      {/* Payout history */}
      <div className="space-y-2 border rounded-2xl p-3">
        <div className="font-medium">Payout history</div>
        {payouts.length === 0 ? (
          <div className="text-sm opacity-70">
            No payout records yet for this driver.
          </div>
        ) : (
          <ul className="space-y-1 text-sm">
            {payouts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between border rounded-lg px-2 py-1"
              >
                <div>
                  <div className="font-medium">
                    ₱{p.amount.toFixed(2)}{" "}
                    <span className="text-xs uppercase text-gray-500">
                      {p.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600">
                    {formatDate(p.processed_at || p.requested_at)}
                  </div>
                </div>
                <div className="text-xs text-right">
                  <div className="uppercase text-gray-500">
                    {p.payout_method || "GCASH"}
                  </div>
                  {p.payout_reference && (
                    <div className="font-mono">
                      Ref: {p.payout_reference}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}




