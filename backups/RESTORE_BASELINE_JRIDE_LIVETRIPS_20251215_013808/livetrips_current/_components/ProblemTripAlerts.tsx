"use client";

type ProblemTrip = {
  id: string;
  booking_code: string;
  passenger_name: string | null;
  zone: string | null;
  status: string;
  driver_status: string | null;
  driver_town: string | null;
  driver_updated_at: string | null;
};

interface Props {
  trips: ProblemTrip[];
}

export default function ProblemTripAlerts({ trips }: Props) {
  if (!trips || trips.length === 0) return null;

  return (
    <div className="mb-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex justify-between items-center mb-1 text-[11px] uppercase tracking-wide text-red-700">
        <span>Problem trips</span>
        <span>{trips.length}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {trips.map((t) => (
          <div
            key={t.id}
            className="px-3 py-1 rounded-full bg-white border border-red-200 text-red-800 shadow-sm"
          >
            <span className="font-semibold mr-1">{t.booking_code}</span>
            <span className="mr-1">({t.zone ?? "Unknown zone"})</span>
            <span className="mr-1">status: {t.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
