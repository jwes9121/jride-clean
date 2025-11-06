"use client";
import React from "react";
import type { DriverLocation, Ride } from "@/types";
import { townColor } from "./townColors";

export function DriverPanel({ drivers }: { drivers: DriverLocation[] }) {
  return (
    <div className="rounded-2xl bg-white shadow p-3 h-[420px] overflow-auto">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Drivers</h2>
        <span className="text-xs text-gray-500">{drivers.length} total</span>
      </div>
      <ul className="space-y-2">
        {drivers.map((d) => (
          <li key={d.id} className="flex items-center justify-between rounded-xl border p-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-6 rounded" style={{ background: townColor(d.town ?? undefined) }} title={d.town ?? ""}/>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{d.name}</span>
                <span className="text-xs text-gray-500">{d.town ?? "—"} · {d.status}</span>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {d.lat && d.lng ? `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}` : "no fix"}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RidePanel({ rides, onAssignNearest, selectedRideId, onSelect }:{
  rides: Ride[]; onAssignNearest: (rideId: string) => void; selectedRideId?: string | null; onSelect: (rideId: string) => void;
}) {
  return (
    <div className="rounded-2xl bg-white shadow p-3 h-[420px] overflow-auto">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Active Rides</h2>
        <span className="text-xs text-gray-500">{rides.length} total</span>
      </div>
      <ul className="space-y-2">
        {rides.map((r) => {
          const active = r.id === selectedRideId;
          return (
            <li key={r.id} onClick={() => onSelect(r.id)}
              className={`rounded-xl border p-2 flex items-center justify-between cursor-pointer ${active ? "ring-2 ring-gray-900 border-gray-900" : ""}`}>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{r.id}</span>
                <span className="text-xs text-gray-500">{r.town ?? "—"} · {r.status}</span>
              </div>
              <button onClick={(e) => { e.stopPropagation(); onAssignNearest(r.id); }}
                className="px-3 py-1 rounded-lg bg-gray-900 text-white text-xs hover:opacity-90">
                Assign Nearest
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
