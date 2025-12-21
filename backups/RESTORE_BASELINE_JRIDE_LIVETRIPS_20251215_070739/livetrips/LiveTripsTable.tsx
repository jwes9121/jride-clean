"use client";

import { cn } from "@/lib/utils";

type BookingWithExtras = {
  id: string;
  code: string;
  passenger_name: string | null;
  passenger_phone: string | null;
  pickup: string | null;
  dropoff: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  assigned_driver_id: string | null;
  assigned_driver_name: string | null;
  assigned_driver_phone: string | null;
  town: string | null;
  zone: string | null;
  eta_minutes: number | null;
  driver_status: string | null;
  driver_online: boolean;
  driver_location_updated_at: string | null;
  issues: string | null;
  age_minutes: number | null;
};

interface LiveTripsTableProps {
  activeBookings: BookingWithExtras[] | null | undefined;
  recentCompleted: BookingWithExtras[] | null | undefined;
  selectedBooking: BookingWithExtras | null;
  onSelectBooking: (booking: BookingWithExtras | null) => void;
}

function StatusBadge({ booking }: { booking: BookingWithExtras }) {
  const status = booking.status ?? "Unknown";

  let classes = "bg-slate-100 text-slate-700 border-slate-200";
  if (status === "Pending") {
    classes = "bg-amber-50 text-amber-700 border-amber-200";
  } else if (status === "On the way") {
    classes = "bg-sky-50 text-sky-700 border-sky-200";
  } else if (status === "On trip") {
    classes = "bg-emerald-50 text-emerald-700 border-emerald-200";
  } else if (status === "Completed") {
    classes = "bg-slate-100 text-slate-600 border-slate-200";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        classes
      )}
    >
      {status}
    </span>
  );
}

function DriverBadge({ booking }: { booking: BookingWithExtras }) {
  if (!booking.assigned_driver_name) {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
        Unassigned
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
      {booking.assigned_driver_name}
    </span>
  );
}

function EtaCell({ booking }: { booking: BookingWithExtras }) {
  if (booking.eta_minutes == null) return <span className="text-[11px] text-slate-400">—</span>;
  const minutes = Math.max(0, Math.round(booking.eta_minutes));
  return (
    <span className="text-[11px] font-semibold text-slate-800">
      {minutes} min
    </span>
  );
}

export default function LiveTripsTable({
  activeBookings,
  recentCompleted,
  selectedBooking,
  onSelectBooking,
}: LiveTripsTableProps) {
  const active: BookingWithExtras[] = Array.isArray(activeBookings)
    ? (activeBookings as BookingWithExtras[])
    : [];
  const recent: BookingWithExtras[] = Array.isArray(recentCompleted)
    ? (recentCompleted as BookingWithExtras[])
    : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Active & recent trips
          </span>
          <span className="text-xs text-slate-500">
            Click a row to inspect details and follow the trip on the map.
          </span>
        </div>
        <div className="text-[11px] text-slate-500">
          <span className="font-semibold text-slate-800">{active.length}</span>{" "}
          active •{" "}
          <span className="font-semibold text-slate-800">{recent.length}</span>{" "}
          recent
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="min-w-full border-b border-slate-200 text-xs">
          <thead className="bg-slate-50/80">
            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">Code</th>
              <th className="px-3 py-2 text-left font-semibold">Passenger</th>
              <th className="px-3 py-2 text-left font-semibold">Pickup</th>
              <th className="px-3 py-2 text-left font-semibold">Dropoff</th>
              <th className="px-3 py-2 text-left font-semibold">Zone</th>
              <th className="px-3 py-2 text-left font-semibold">Driver</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">ETA</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {active.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-[11px] text-slate-500"
                >
                  No active trips at the moment.
                </td>
              </tr>
            )}

            {active.map((booking) => {
              const isSelected = selectedBooking?.id === booking.id;

              return (
                <tr
                  key={booking.id}
                  className={cn(
                    "cursor-pointer border-t border-slate-100 hover:bg-slate-50",
                    isSelected && "bg-emerald-50/40"
                  )}
                  onClick={() => onSelectBooking(booking)}
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900">
                        {booking.code}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {booking.created_at
                          ? new Date(booking.created_at).toLocaleString()
                          : ""}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900">
                        {booking.passenger_name ?? "—"}
                      </span>
                      {booking.passenger_phone && (
                        <span className="text-[10px] text-slate-500">
                          {booking.passenger_phone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="line-clamp-2 text-[11px] text-slate-700">
                      {booking.pickup ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="line-clamp-2 text-[11px] text-slate-700">
                      {booking.dropoff ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[11px] text-slate-700">
                      {booking.zone ?? booking.town ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <DriverBadge booking={booking} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge booking={booking} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <EtaCell booking={booking} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Recent completed section */}
        {recent.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500">
            <div className="mb-1 font-semibold text-slate-600">
              Recent completed trips
            </div>
            <div className="flex flex-wrap gap-2">
              {recent.slice(0, 6).map((booking) => (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => onSelectBooking(booking)}
                  className={cn(
                    "rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:border-slate-300",
                    selectedBooking?.id === booking.id && "border-emerald-400"
                  )}
                >
                  {booking.code} • {booking.passenger_name ?? "Passenger"}
                </button>
              ))}
              {recent.length > 6 && (
                <span className="text-[10px] text-slate-400">
                  +{recent.length - 6} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
