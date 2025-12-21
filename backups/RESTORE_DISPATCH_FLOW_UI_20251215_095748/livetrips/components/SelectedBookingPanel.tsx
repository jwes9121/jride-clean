"use client";

import type { LiveTrip } from "../actions/getLiveTrips";
import LiveTripMapClient from "../map/LiveTripMapClient";

type Props = {
  booking: LiveTrip | null;
};

export default function SelectedBookingPanel({ booking }: Props) {
  if (!booking) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        Select a booking to inspect details and follow the trip on the map.
      </div>
    );
  }

  const { booking_code, passenger_name, pickup, dropoff } = booking;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs">
        <div className="font-semibold text-slate-700">{booking_code}</div>
        <div className="text-slate-500">
          {passenger_name ?? "No passenger name"}
        </div>
      </div>

      <div className="flex-1 min-h-[320px]">
        <LiveTripMapClient
          pickup={pickup ?? undefined}
          dropoff={dropoff ?? undefined}
        />
      </div>
    </div>
  );
}
