"use client";

import React from "react";
import type { LiveTrip } from "./ZoneCapacityView";

type ProblemAlert = {
  id: string;
  booking_code: string;
  zone: string;
  status: string;
  message: string;
};

function findProblemTrips(trips: LiveTrip[]): ProblemAlert[] {
  const alerts: ProblemAlert[] = [];

  for (const t of trips) {
    const zone = (t.zone || t.town || "Unknown") as string;

    // 1) Pending / assigned but no driver
    if ((t.status === "pending" || t.status === "assigned") && !t.driver_id) {
      alerts.push({
        id: t.id,
        booking_code: t.booking_code,
        zone,
        status: t.status,
        message: "No driver assigned",
      });
    }

    // 2) On the way / on trip but no live location
    //    (we use `any` here so TS won't complain if these fields are absent)
    const anyTrip = t as any;
    const lat = anyTrip.driver_lat;
    const lng = anyTrip.driver_lng;

    if (
      (t.status === "on_the_way" || t.status === "on_trip") &&
      (lat == null || lng == null)
    ) {
      alerts.push({
        id: t.id,
        booking_code: t.booking_code,
        zone,
        status: t.status,
        message: "Missing live driver location",
      });
    }

    // 3) Driver in a different town than the trip zone
    const driverTown = anyTrip.driver_town as string | null | undefined;
    if (driverTown && driverTown !== zone) {
      alerts.push({
        id: t.id,
        booking_code: t.booking_code,
        zone,
        status: t.status,
        message: `Driver out of zone (${driverTown} → ${zone})`,
      });
    }
  }

  return alerts;
}

export default function ProblemTripAlerts({ trips }: { trips: LiveTrip[] }) {
  const alerts = findProblemTrips(trips);

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-slate-700">Problem Trips</span>
        <span
          className={
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold " +
            (alerts.length === 0
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700")
          }
        >
          {alerts.length} issue{alerts.length === 1 ? "" : "s"}
        </span>
      </div>

      {alerts.length === 0 ? (
        <div className="text-[11px] text-slate-500">
          No obvious problems detected on active trips.
        </div>
      ) : (
        <ul className="space-y-1">
          {alerts.slice(0, 4).map((a) => (
            <li
              key={a.id + a.message}
              className="flex items-start justify-between gap-2 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-800"
            >
              <div>
                <div className="font-semibold">{a.booking_code}</div>
                <div className="text-[10px]">
                  {a.zone} · {a.message}
                </div>
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                {a.status}
              </span>
            </li>
          ))}
          {alerts.length > 4 && (
            <li className="text-[10px] italic text-red-600">
              + {alerts.length - 4} more…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
