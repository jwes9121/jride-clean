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

  const [assigned, setAssigned] = useState<Ride | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);

  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);

  useEffect(() => {
    if (!driverId) return;

    async function loadAssignedAndWallet() {
      // Current active ride
      const { data: ridesData } = await sb
        .from("rides")
        .select("*")
        .eq("driver_id", driverId)
        .in("status", ["assigned", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(1);

      setAssigned((ridesData || [])[0] as Ride | null);

      // Wallet status
      const { data: walletData } = await sb
        .from("driver_wallet_status_view")
        .select("*")
        .eq("driver_id", driverId)
        .limit(1);

      const ws = (walletData || [])[0] as WalletStatus | undefined;
      setWallet(ws || null);

      // Payout history for this driver
      const { data: payoutData } = await sb
        .from("driver_payout_requests")
        .select(
          "id, amount, status, requested_at, processed_at, payout_method, payout_reference"
        )
        .eq("driver_id", driverId)
        .order("requested_at", { ascending: false })
        .limit(10);

      setPayouts((payoutData || []) as Payout[]);
    }

    loadAssignedAndWallet();

    const ch = sb
      .channel("driver_rides_" + driverId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rides",
          filter: `driver_id=eq.${driverId}`,
        },
        (p) => {
          const r = p.new as Ride;
          if (["assigned", "in_progress"].includes(r.status)) setAssigned(r);
          if (
            r.status === "completed" &&
            assigned &&
            r.id === assigned.id
          )
            setAssigned(null);
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(ch);
    };
  }, [driverId]); // keep dependency minimal

  const locked =
    wallet && wallet.can_accept_new_jobs === false ? true : false;

  async function startSharing() {
    if (!driverId) {
      alert("Set driver UUID first.");
      return;
    }

    if (locked) {
      alert(
        "Your JRide wallet is below the minimum required load. Please top up before going online."
      );
      return;
    }

    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        await fetch("/api/driver/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driver_id: driverId,
            lat,
            lng,
            is_available: available && !locked,
          }),
        });
      },
      (err) => alert(err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    setWatchId(id);
  }

  function stopSharing() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null);
  }

  async function setStatus(status: "in_progress" | "completed") {
    if (!assigned) return;
    const res = await fetch("/api/rides/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rideId: assigned.id, status }),
    });
    const js = await res.json();
    if (!res.ok) return alert(js?.error || "Failed");
    alert(`Ride ${status.replace("_", " ").toUpperCase()}`);
  }

  function formatDate(value: string | null) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  }

  return (
    <div className="p-6 max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">JRide • Driver</h1>

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
                onClick={() => setStatus("in_progress")}
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
