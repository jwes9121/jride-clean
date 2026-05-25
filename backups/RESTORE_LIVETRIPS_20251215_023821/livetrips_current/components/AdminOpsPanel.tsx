"use client";

import React, { useMemo } from "react";
import type { LiveTrip } from "./ProblemTripAlertSounds";

type Props = {
  trips: LiveTrip[];
  selectedTripId: string | null;
  onSelectTrip: (id: string) => void;
};

// ✅ OFFICIAL ZONE CAPACITY LIMITS
const ZONE_CAPACITY: Record<string, number> = {
  Kiangan: 20,
  Lagawe: 30,
  Banaue: 20,
  Hingyon: 15,
  Lamut: 20,
};

export default function AdminOpsPanel({
  trips,
  selectedTripId,
  onSelectTrip,
}: Props) {
  // ===============================
  // NORMALIZE RPC FIELDS
  // ===============================
  const normalizedTrips = useMemo(() => {
    return trips.map((t: any) => ({
      id: String(t.id ?? t.bookingCode ?? ""),
      code: t.bookingCode ?? t.code ?? t.id,
      driver:
        t.driverName ??
        t.driver ??
        t.driver_name ??
        t.driver?.name ??
        "-",
      zone:
        t.town ??
        t.zone ??
        t.municipality ??
        t.driver?.town ??
        "Unknown",
      status: t.status ?? "-",
      pickupEta:
        typeof t.pickupEtaSeconds === "number"
          ? Math.round(t.pickupEtaSeconds / 60)
          : null,
      tripEta:
        typeof t.dropoffEtaSeconds === "number"
          ? Math.round(t.dropoffEtaSeconds / 60)
          : null,
      isProblem: !!t.isProblem,
    }));
  }, [trips]);

  // ===============================
  // ZONE LOAD + UTILIZATION
  // ===============================
  const zoneStats = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of normalizedTrips) {
      map[t.zone] = (map[t.zone] || 0) + 1;
    }

    return Object.entries(map).map(([zone, count]) => {
      const limit = ZONE_CAPACITY[zone] ?? 20;
      const util = Math.round((count / limit) * 100);
      let status: "OK" | "WARN" | "FULL" = "OK";

      if (util >= 90 && util < 100) status = "WARN";
      if (util >= 100) status = "FULL";

      return { zone, count, limit, util, status };
    });
  }, [normalizedTrips]);

  // ===============================
  // OVERLOAD SUMMARY (FOR BANNER)
  // ===============================
  const overload = useMemo(() => {
    let hasWarn = false;
    let hasFull = false;

    for (const z of zoneStats) {
      if (z.status === "WARN") hasWarn = true;
      if (z.status === "FULL") hasFull = true;
    }

    return { hasWarn, hasFull };
  }, [zoneStats]);

  return (
    <div className="flex h-full flex-col">

      {/* ===============================
          ZONE LOAD + CAPACITY
      =============================== */}
      <div className="border-b bg-slate-50 p-2">
        <div className="font-semibold text-xs mb-2">
          Zone Load Monitoring
        </div>

        {/* Overload banner */}
        {(overload.hasWarn || overload.hasFull) && (
          <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            {overload.hasFull
              ? "Some zones are at FULL capacity. Do not assign new trips into those zones."
              : "Some zones are nearing capacity (90%+). Use caution when assigning new trips."}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          {zoneStats.map((z) => (
            <div
              key={z.zone}
              className="rounded border bg-white px-2 py-1"
            >
              <div className="flex justify-between font-semibold">
                <span>{z.zone}</span>
                <span>{z.count}/{z.limit}</span>
              </div>

              <div className="mt-1 flex justify-between items-center">
                <span className="text-[11px] text-slate-500">
                  {z.util}% utilized
                </span>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    z.status === "OK"
                      ? "bg-emerald-100 text-emerald-700"
                      : z.status === "WARN"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {z.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===============================
          OPS TRIP TABLE
      =============================== */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-100 z-10">
            <tr>
              <th className="border px-2 py-1">Code</th>
              <th className="border px-2 py-1">Driver</th>
              <th className="border px-2 py-1">Zone</th>
              <th className="border px-2 py-1">Status</th>
              <th className="border px-2 py-1">Pickup ETA</th>
              <th className="border px-2 py-1">Trip ETA</th>
            </tr>
          </thead>
          <tbody>
            {normalizedTrips.map((t) => (
              <tr
                key={t.id}
                onClick={() => onSelectTrip(t.id)}
                className={`cursor-pointer hover:bg-slate-50 ${
                  t.id === selectedTripId ? "bg-sky-50" : ""
                } ${t.isProblem ? "bg-red-50" : ""}`}
              >
                <td className="border px-2 py-1 font-semibold">
                  {t.code}
                </td>
                <td className="border px-2 py-1">
                  {t.driver}
                </td>
                <td className="border px-2 py-1">
                  {t.zone}
                </td>
                <td className="border px-2 py-1">
                  {t.status}
                </td>
                <td className="border px-2 py-1 text-right text-emerald-600">
                  {t.pickupEta !== null ? `${t.pickupEta} min` : "--"}
                </td>
                <td className="border px-2 py-1 text-right text-slate-600">
                  {t.tripEta !== null ? `${t.tripEta} min` : "--"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
