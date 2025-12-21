"use client";

import React, { useMemo, useState } from "react";

type LiveTripAny = any;

type DriverLite = {
  id: string;
  name: string;
  homeTown?: string;
  zone?: string;
  status?: string;
};

function s(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

function normZone(v: any) {
  const z = s(v).trim();
  if (!z || z === "-" || z.toLowerCase() === "null" || z.toLowerCase() === "undefined") return "Unknown";
  const towns = ["Lagawe", "Kiangan", "Lamut", "Banaue", "Hingyon", "Unknown"];
  const hit = towns.find((t) => t.toLowerCase() === z.toLowerCase());
  return hit ?? z;
}

function tripId(t: any) {
  return String(t?.uuid ?? t?.id ?? t?.booking_uuid ?? t?.booking_id ?? t?.bookingCode ?? t?.booking_code ?? "");
}

export default function AdminOpsPanel({
  trips,
  selectedTripId,
  onSelectTrip,
  drivers,
  onManualAssign,
  lastAction,
}: {
  trips: LiveTripAny[];
  selectedTripId: string | null;
  onSelectTrip: (id: string) => void;
  drivers: DriverLite[];
  onManualAssign: (driverId: string) => void | Promise<void>;
  lastAction?: string;
}) {
  const [manualDriverId, setManualDriverId] = useState("");

  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return (trips || []).find((t) => tripId(t) === selectedTripId) ?? null;
  }, [trips, selectedTripId]);

  const zone = useMemo(() => normZone(selectedTrip?.town ?? selectedTrip?.zone), [selectedTrip]);

  const driverOptions = useMemo(() => {
    const list = (drivers || []).filter(Boolean).map((d: any) => ({
      id: String(d.id),
      name: String(d.name ?? `Driver ${String(d.id).slice(0, 4)}`),
      town: normZone(d.homeTown ?? d.zone),
    }));

    // Ordinance default: same-town only if zone known
    if (zone && zone !== "Unknown") {
      const sameTown = list.filter((d) => d.town.toLowerCase() === zone.toLowerCase());
      return sameTown;
    }
    return list;
  }, [drivers, zone]);

  const handleAssign = async () => {
    if (!manualDriverId) return;
    await onManualAssign(manualDriverId);
  };

  const activeTripsCount = trips?.length ?? 0;

  return (
    <div className="p-3 space-y-3">
      <div className="rounded border bg-white p-3">
        <div className="text-xs text-slate-500">Active Trips</div>
        <div className="text-2xl font-bold">{activeTripsCount}</div>
      </div>

      <div className="rounded border bg-white">
        <div className="border-b px-3 py-2 text-xs font-semibold">Zone Load Monitoring</div>
        <div className="px-3 py-2 text-xs text-slate-600">
          {zone} <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-[11px]">selected trip</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-2 text-left">Code</th>
                <th className="px-2 py-2 text-left">Driver</th>
                <th className="px-2 py-2 text-left">Zone</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Pickup ETA</th>
                <th className="px-2 py-2 text-left">Trip ETA</th>
              </tr>
            </thead>
            <tbody>
              {(trips || []).slice(0, 30).map((t) => {
                const id = tripId(t);
                const isSel = id === selectedTripId;

                return (
                  <tr
                    key={id}
                    className={isSel ? "bg-emerald-50 cursor-pointer" : "hover:bg-slate-50 cursor-pointer"}
                    onClick={() => onSelectTrip(id)}
                  >
                    <td className="px-2 py-2">{s(t.booking_code ?? t.bookingCode ?? id).slice(0, 18)}</td>
                    <td className="px-2 py-2">{s(t.driver_name ?? t.driverName ?? "—")}</td>
                    <td className="px-2 py-2">{normZone(t.town ?? t.zone ?? "Unknown")}</td>
                    <td className="px-2 py-2">{s(t.status ?? "—")}</td>
                    <td className="px-2 py-2">{s(t.pickup_eta ?? t.pickupEta ?? "—")}</td>
                    <td className="px-2 py-2">{s(t.trip_eta ?? t.tripEta ?? "—")}</td>
                  </tr>
                );
              })}
              {(!trips || trips.length === 0) ? (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-500">No trips</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded border bg-white p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold">Trip control & wallet</div>
          <div className="text-[11px] text-slate-500">Status: {s(selectedTrip?.status ?? "—")}</div>
        </div>

        {!selectedTrip ? (
          <div className="mt-2 text-[11px] text-slate-500">Select a trip first.</div>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded border p-2">
                <div className="text-slate-500">Fare</div>
                <div className="font-semibold">{s(selectedTrip.fare ?? selectedTrip.fare_amount ?? "—")}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-slate-500">Platform fee</div>
                <div className="font-semibold">{s(selectedTrip.platform_fee ?? selectedTrip.service_fee ?? "—")}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-slate-500">Driver wallet</div>
                <div className="font-semibold">{s(selectedTrip.driver_wallet ?? selectedTrip.driver_wallet_balance ?? "—")}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-slate-500">Vendor wallet</div>
                <div className="font-semibold">{s(selectedTrip.vendor_wallet ?? selectedTrip.vendor_wallet_balance ?? "—")}</div>
              </div>
            </div>

            <div className="mt-2">
              <div className="flex items-center gap-2">
                <select
                  className="w-full rounded border px-2 py-1 text-[11px]"
                  value={manualDriverId}
                  onChange={(e) => setManualDriverId(e.target.value)}
                >
                  <option value="">
                    {driverOptions.length === 0
                      ? "No drivers in dropdown: driver_locations blocked by RLS or not available."
                      : "Select driver"}
                  </option>
                  {driverOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} • {d.town}
                    </option>
                  ))}
                </select>

                <button
                  className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                  disabled={!manualDriverId}
                  onClick={handleAssign}
                >
                  Assign
                </button>
              </div>

              {lastAction ? (
                <div className="mt-1 text-[11px] text-slate-600">Last action: {lastAction}</div>
              ) : null}

              <div className="mt-2 grid grid-cols-3 gap-2">
                <button className="rounded border px-2 py-1 text-[11px] text-slate-400" disabled>On the way</button>
                <button className="rounded border px-2 py-1 text-[11px] text-slate-400" disabled>Start trip</button>
                <button className="rounded border px-2 py-1 text-[11px] text-slate-400" disabled>Drop off</button>
              </div>

              <div className="mt-1 text-[10px] text-slate-400">
                Dropdown sources: props → suggestions → driver_locations fallback.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
