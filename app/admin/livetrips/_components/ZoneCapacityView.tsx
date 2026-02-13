"use client";

type ZoneRow = {
  town: string | null;
  online_drivers: number;
  active_trips: number;
};

interface Props {
  zones: ZoneRow[];
}

export default function ZoneCapacityView({ zones }: Props) {
  if (!zones || zones.length === 0) return null;

  const totalDrivers = zones.reduce(
    (sum, z) => sum + (z.online_drivers ?? 0),
    0
  );
  const totalTrips = zones.reduce(
    (sum, z) => sum + (z.active_trips ?? 0),
    0
  );

  return (
    <div className="mb-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg">
      <div className="flex justify-between items-center mb-2 text-[11px] uppercase tracking-wide text-slate-500">
        <span>Zone capacity</span>
        <span>
          {totalTrips} active trip(s) / {totalDrivers} online driver(s)
        </span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {zones.map((z) => (
          <div
            key={z.town ?? "unknown"}
            className="px-3 py-1 rounded-full bg-white border border-slate-200 shadow-sm flex items-center gap-2"
          >
            <span className="font-semibold">{z.town ?? "Unknown"}</span>
            <span className="text-slate-500">Trips: {z.active_trips}</span>
            <span className="text-slate-500">Drivers: {z.online_drivers}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
