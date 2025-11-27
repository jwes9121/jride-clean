"use client";

import { useMemo } from "react";
import {
  BookingStatus,
  BookingRowForRules,
  buildDriverLabel,
  buildDriverMap,
  DriverInfo,
  DriverMap,
  getButtonRules,
} from "./dispatchRules";

export type BookingRow = {
  id: string;
  booking_code: string;
  status: BookingStatus;
  assigned_driver_id: string | null;
  from_label?: string | null;
  to_label?: string | null;
  created_at: string;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
};

type Props = {
  booking: BookingRow;
  drivers: DriverInfo[];
  isWorking?: boolean;

  onAssign: (booking: BookingRow) => void;
  onReassign: (booking: BookingRow) => void;
  onCancel: (booking: BookingRow) => void;
  onMarkOnTheWay: (booking: BookingRow) => void;
  onStartTrip: (booking: BookingRow) => void;
  onDropOff: (booking: BookingRow) => void;
  onViewMap: (booking: BookingRow) => void;
};

export default function DispatchRow({
  booking,
  drivers,
  isWorking = false,
  onAssign,
  onReassign,
  onCancel,
  onMarkOnTheWay,
  onStartTrip,
  onDropOff,
  onViewMap,
}: Props) {
  const driversById: DriverMap = useMemo(
    () => buildDriverMap(drivers),
    [drivers]
  );

  const driverLabel = buildDriverLabel(
    booking.assigned_driver_id,
    driversById
  );

  const rules = getButtonRules({
    status: booking.status,
    assigned_driver_id: booking.assigned_driver_id,
    hasPickupCoords: !!(booking.pickup_lat && booking.pickup_lng),
    hasDropoffCoords: !!(booking.dropoff_lat && booking.dropoff_lng),
  } as BookingRowForRules);

  const fromLabel = booking.from_label || "(no pickup label)";
  const toLabel = booking.to_label || "(no dropoff label)";

  return (
    <tr className="text-sm">
      <td className="px-3 py-2 font-mono whitespace-nowrap">
        {booking.booking_code}
      </td>
      <td className="px-3 py-2">
        <div className="font-semibold">{driverLabel}</div>
        <div className="text-xs text-gray-500 capitalize">
          {booking.status.replace(/_/g, " ")}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="text-xs">
          <div>{fromLabel}</div>
          <div className="text-gray-500">→ {toLabel}</div>
        </div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
        {new Date(booking.created_at).toLocaleString()}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs border border-gray-300 disabled:opacity-40"
            disabled={!rules.canAssign || isWorking}
            onClick={() => onAssign(booking)}
          >
            Assign
          </button>

          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs border border-gray-300 disabled:opacity-40"
            disabled={!rules.canReassign || isWorking}
            onClick={() => onReassign(booking)}
          >
            Reassign
          </button>

          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs border border-gray-300 disabled:opacity-40"
            disabled={!rules.canMarkOnTheWay || isWorking}
            onClick={() => onMarkOnTheWay(booking)}
          >
            On the way
          </button>

          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs border border-gray-300 disabled:opacity-40"
            disabled={!rules.canStartTrip || isWorking}
            onClick={() => onStartTrip(booking)}
          >
            Start trip
          </button>

          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs border border-gray-300 disabled:opacity-40"
            disabled={!rules.canDropOff || isWorking}
            onClick={() => onDropOff(booking)}
          >
            Drop off
          </button>

          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs border border-red-300 text-red-600 disabled:opacity-40"
            disabled={!rules.canCancel || isWorking}
            onClick={() => onCancel(booking)}
          >
            Cancel
          </button>

          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs border border-blue-300 text-blue-600 disabled:opacity-40"
            disabled={!rules.canViewMap || isWorking}
            onClick={() => onViewMap(booking)}
          >
            View map
          </button>
        </div>
      </td>
    </tr>
  );
}
