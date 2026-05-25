"use client";

import React, { useMemo } from "react";
import type { LiveTrip } from "./ProblemTripAlertSounds";

type ZoneCapRow = {
  zone_id: string;
  zone_name: string;
  color_hex: string | null;
  capacity_limit: number | null;
  active_drivers: number | null;
  available_slots: number | null;
  status: "FULL" | "NEAR" | "AVAILABLE" | string;
};

type DriverScoreRow = {
  driver_id: string;
  driver_name: string | null;
  score_0_100: number | null;
  tier: "GOLD" | "SILVER" | "NEEDS_ATTENTION" | string;
};

type DriverEarningsRow = {
  driver_id: string;
  driver_name: string | null;
  earned_today: number | null;
  earned_this_week: number | null;
  earned_this_month: number | null;
  completed_30d: number | null;
};

type Props = {
  trips: LiveTrip[];
  selectedTripId: string | null;
  onSelectTrip: (id: string) => void;
  zoneCaps: ZoneCapRow[];
  driverScores: Record<string, DriverScoreRow>;
  driverEarnings: Record<string, DriverEarningsRow>;
};

function fmtPeso(n: any): string {
  const v = typeof n === "number" ? n : parseFloat(String(n ?? "0"));
  if (!Number.isFinite(v)) return "₱0";
  return `₱${Math.round(v).toLocaleString("en-PH")}`;
}

function scoreBadge(tier?: string) {
  const t = (tier || "").toUpperCase();
  if (t === "GOLD") return "bg-emerald-100 text-emerald-700";
  if (t === "SILVER") return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

export default function AdminOpsPanel({
  trips,
  selectedTripId,
  onSelectTrip,
  zoneCaps,
  driverScores,
  driverEarnings,
}: Props) {
  const zoneById = useMemo(() => {
    const m: Record<string, ZoneCapRow> = {};
    (zoneCaps || []).forEach((z) => {
      if (z?.zone_id) m[String(z.zone_id)] = z;
    });
    return m;
  }, [zoneCaps]);

  const zoneCards = useMemo(() => {
    const rows = (zoneCaps || []).slice().sort((a, b) =>
      String(a.zone_name).localeCompare(String(b.zone_name), "en")
    );

    return rows.map((z) => {
      const util =
        z.capacity_limit && z.capacity_limit > 0
          ? Math.round(((z.active_drivers ?? 0) / z.capacity_limit) * 100)
          : 0;

      const status = String(z.status || "AVAILABLE").toUpperCase();
      const pill =
        status === "FULL"
          ? "bg-rose-100 text-rose-700"
          : status === "NEAR"
          ? "bg-amber-100 text-amber-700"
          : "bg-emerald-100 text-emerald-700";

      return { ...z, util, pill };
    });
  }, [zoneCaps]);

  const overload = useMemo(() => {
    let hasWarn = false;
    let hasFull = false;
    for (const z of zoneCards) {
      if (String(z.status).toUpperCase() === "NEAR") hasWarn = true;
      if (String(z.status).toUpperCase() === "FULL") hasFull = true;
    }
    return { hasWarn, hasFull };
  }, [zoneCards]);

  const normalizedTrips = useMemo(() => {
    return (trips || []).map((t: any) => {
      const id = String(t.id ?? t.bookingId ?? t.booking_id ?? t.bookingCode ?? t.booking_code ?? "");
      const code = t.bookingCode ?? t.booking_code ?? t.code ?? t.id;

      const driverId = String(
        t.driver_id ?? t.driverId ?? t.assigned_driver_id ?? t.assignedDriverId ?? ""
      );

      const driverName =
        t.driverName ?? t.driver ?? t.driver_name ?? t.driver?.name ?? "-";

      // ✅ Zone resolution priority:
      // 1) explicit name fields if present (views may expose these)
      // 2) zone_id -> zone_capacity_view map
      // 3) fallback strings (old)
      const zoneId = String(t.zone_id ?? t.booking_zone_id ?? "");
      const zRow = zoneId && zoneById[zoneId] ? zoneById[zoneId] : null;

      const zoneName =
        t.zone_name_resolved ??
        t.zone_name ??
        t.pickup_zone_name ??
        t.from_zone_name ??
        (zRow?.zone_name ?? null) ??
        t.town ??
        t.zone ??
        t.municipality ??
        "Unknown";

      const pickupEtaMin =
        typeof t.pickupEtaSeconds === "number"
          ? Math.round(t.pickupEtaSeconds / 60)
          : typeof t.pickup_eta_seconds === "number"
          ? Math.round(t.pickup_eta_seconds / 60)
          : null;

      const tripEtaMin =
        typeof t.dropoffEtaSeconds === "number"
          ? Math.round(t.dropoffEtaSeconds / 60)
          : typeof t.dropoff_eta_seconds === "number"
          ? Math.round(t.dropoff_eta_seconds / 60)
          : null;

      const score = driverId && driverScores[driverId] ? driverScores[driverId] : null;
      const earn = driverId && driverEarnings[driverId] ? driverEarnings[driverId] : null;

      return {
        id,
        code,
        driverId,
        driver: driverName,
        zoneId,
        zone: zoneName,
        status: t.status ?? "-",
        isProblem: !!t.isProblem,
        score0_100: score?.score_0_100 ?? null,
        tier: score?.tier ?? null,
        earnedToday: earn?.earned_today ?? null,
        pickupEtaMin,
        tripEtaMin,
      };
    });
  }, [trips, zoneById, driverScores, driverEarnings]);

  return (
    <div className="flex h-full flex-col">
      {/* Zone load from MV */}
      <div className="border-b bg-slate-50 p-2">
        <div className="font-semibold text-xs mb-2">Zone Load Monitoring</div>

        {(overload.hasWarn || overload.hasFull) && (
          <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            {overload.hasFull
              ? "Some zones are FULL capacity. Assignments into FULL zones are blocked."
              : "Some zones are NEAR capacity. Use caution when assigning."}
          </div>
        )}

        {zoneCards.length === 0 ? (
          <div className="text-[11px] text-slate-500">No zone capacity rows found.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {zoneCards.map((z) => (
              <div
                key={String(z.zone_id)}
                className="rounded border bg-white px-2 py-1"
              >
                <div className="flex justify-between font-semibold items-center">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: z.color_hex ?? "#94a3b8" }}
                    />
                    {z.zone_name}
                  </span>
                  <span>
                    {(z.active_drivers ?? 0)}/{(z.capacity_limit ?? 0)}
                  </span>
                </div>

                <div className="mt-1 flex justify-between items-center">
                  <span className="text-[11px] text-slate-500">{z.util}% utilized</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${z.pill}`}>
                    {String(z.status).toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trips table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-100 z-10">
            <tr>
              <th className="border px-2 py-1">Code</th>
              <th className="border px-2 py-1">Driver</th>
              <th className="border px-2 py-1">Zone</th>
              <th className="border px-2 py-1">Status</th>
              <th className="border px-2 py-1">Score</th>
              <th className="border px-2 py-1">Earned Today</th>
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
                <td className="border px-2 py-1 font-semibold">{t.code}</td>
                <td className="border px-2 py-1">{t.driver}</td>
                <td className="border px-2 py-1">{t.zone}</td>
                <td className="border px-2 py-1">{t.status}</td>

                <td className="border px-2 py-1">
                  {t.score0_100 == null ? (
                    <span className="text-slate-400">--</span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${scoreBadge(String(t.tier))}`}>
                      {t.score0_100}
                    </span>
                  )}
                </td>

                <td className="border px-2 py-1 text-right">
                  {t.earnedToday == null ? (
                    <span className="text-slate-400">--</span>
                  ) : (
                    <span className="font-semibold text-slate-800">{fmtPeso(t.earnedToday)}</span>
                  )}
                </td>

                <td className="border px-2 py-1 text-right text-emerald-600">
                  {t.pickupEtaMin !== null ? `${t.pickupEtaMin} min` : "--"}
                </td>
                <td className="border px-2 py-1 text-right text-slate-600">
                  {t.tripEtaMin !== null ? `${t.tripEtaMin} min` : "--"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}