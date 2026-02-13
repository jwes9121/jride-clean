"use client";

interface TripEtaPhaseProps {
  etaMinutes: number | null;
  distanceKm: number | null;
  status: string;
  loading?: boolean;
}

function getStatusLabel(status: string): string {
  const key = status.toLowerCase();

  if (key === "on_trip") return "On Trip";
  if (key === "on_the_way") return "On the Way";
  if (key === "assigned") return "Assigned";
  if (key === "pending") return "Pending";
  if (key === "completed") return "Completed";
  if (key === "cancelled") return "Cancelled";

  return status;
}

export default function TripEtaPhase(props: TripEtaPhaseProps) {
  const { etaMinutes, distanceKm, status, loading } = props;

  const statusLabel = getStatusLabel(status);

  return (
    <div className="flex flex-col items-end text-right gap-0.5">
      <div className="flex items-center gap-1 text-[11px] font-medium text-gray-600">
        <span className="uppercase tracking-wide text-gray-400">
          Status:
        </span>
        <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-800 text-[10px]">
          {statusLabel}
        </span>
      </div>

      {loading ? (
        <div className="text-[11px] text-gray-400">
          Calculating ETA…
        </div>
      ) : etaMinutes !== null ? (
        <div className="text-[11px]">
          <span className="text-gray-500">ETA:</span>{" "}
          <span className="font-semibold text-emerald-600">
            {etaMinutes} min
          </span>
          {distanceKm !== null && (
            <span className="ml-1 text-gray-400">
              ({distanceKm} km)
            </span>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-gray-400">
          ETA unavailable
        </div>
      )}
    </div>
  );
}
