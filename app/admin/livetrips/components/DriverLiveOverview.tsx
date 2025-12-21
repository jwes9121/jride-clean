"use client";

import React from "react";

// Local fallback: DispatchActionTrip is not exported by DispatchActionPanel
type DispatchActionTrip = any;

import DispatchActionPanel from "./DispatchActionPanel";
type RawTrip = {
  id?: string;
  booking_code?: string | null;
  status?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  passenger_name?: string | null;
  town?: string | null;
  zone?: string | null;
  is_emergency?: boolean | null;
  [key: string]: any;
};

type Props = {
  trip?: RawTrip | null;
  selectedTrip?: RawTrip | null;
  dispatcherName?: string | null;
};

function mapTrip(raw: RawTrip | null | undefined): DispatchActionTrip | null {
  if (!raw || !raw.id) return null;

  return {
    id: raw.id,
    booking_code: raw.booking_code ?? null,
    status: raw.status ?? null,
    driver_id: raw.driver_id ?? null,
    driver_name: raw.driver_name ?? null,
    driver_phone: raw.driver_phone ?? null,
    passenger_name: raw.passenger_name ?? null,
    town: raw.town ?? raw.zone ?? null,
    is_emergency: raw.is_emergency ?? false,
  };
}

export default function DriverLiveOverview(props: Props) {
  const raw = props.trip ?? props.selectedTrip ?? null;
  const trip = mapTrip(raw);

  return (
    <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-3">
      <div className="text-xs text-white font-semibold">
        ✅ DISPATCH ACTION PANEL ACTIVE
      </div>

      <DispatchActionPanel
        selectedTrip={trip}
        dispatcherName={props.dispatcherName ?? undefined}
      />
    </div>
  );
}


