"use client";
import React from "react";
type Props = { onRefresh: () => void; ridesCount: number; driversOnline: number; driversTotal: number; };
export default function LiveTripsHeader({ onRefresh, ridesCount, driversOnline, driversTotal }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white shadow">
      <div className="flex flex-col">
        <h1 className="text-xl font-semibold">Live Trips</h1>
        <p className="text-sm text-gray-600">
          Active rides: <span className="font-medium">{ridesCount}</span> · Drivers online: <span className="font-medium">{driversOnline}/{driversTotal}</span>
        </p>
      </div>
      <button onClick={onRefresh} className="px-4 py-2 rounded-xl bg-gray-900 text-white hover:opacity-90">Refresh</button>
    </div>
  );
}
