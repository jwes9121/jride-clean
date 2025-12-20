"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type ZoneCapacityItem = {
  zone_id: string;
  zone_name: string;
  color_hex: string | null;
  capacity_limit: number;
  active_drivers: number;
  available_slots: number;
  status: "FULL" | "NEAR" | "AVAILABLE" | string;
};

function getTownKey(name: string | null | undefined) {
  return (name ?? "").toLowerCase().trim();
}

/**
 * OFFICIAL TOWN COLORS (for all JRide modules)
 * Lagawe  - maroon         (#800000)
 * Lamut   - light yellow   (#FEF9C3 / #FACC15)
 * Kiangan - light green    (#BBF7D0 / #4ADE80)
 * Hingyon - light blue     (#BAE6FD / #38BDF8)
 * Banaue  - dark yellow    (#CA8A04)
 */
function getTownDotColor(name: string | null | undefined): string {
  const key = getTownKey(name);

  switch (key) {
    case "lagawe":
      return "#800000"; // maroon
    case "lamut":
      return "#FEF9C3"; // light yellow
    case "kiangan":
      return "#BBF7D0"; // light green
    case "hingyon":
      return "#BAE6FD"; // light blue
    case "banaue":
      return "#CA8A04"; // dark yellow
    default:
      return "#9CA3AF"; // gray fallback
  }
}

function getStatusBorderClass(status: string | null | undefined): string {
  const s = (status ?? "").toUpperCase();
  if (s === "FULL") return "border-red-400";
  if (s === "NEAR") return "border-yellow-400";
  return "border-emerald-300";
}

export default function ZoneCapacity() {
  const { data, error, isLoading } = useSWR<ZoneCapacityItem[]>(
    "/api/zones/capacity",
    fetcher,
    {
      refreshInterval: 5000,
    }
  );

  if (isLoading) {
    return (
      <div className="p-2 text-xs text-gray-500">
        Loading zone capacity overview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-2 text-xs text-red-500">
        Failed to load zone capacity.
      </div>
    );
  }

  const zones: ZoneCapacityItem[] = Array.isArray(data) ? data : [];

  // Sort by town name for stable display
  const sorted = [...zones].sort((a, b) =>
    a.zone_name.localeCompare(b.zone_name)
  );

  const totalActive = sorted.reduce(
    (sum, z) => sum + (z.active_drivers ?? 0),
    0
  );
  const totalSlots = sorted.reduce(
    (sum, z) => sum + (z.capacity_limit ?? 0),
    0
  );

  return (
    <div className="w-full">
      {/* Top chips row with official town colors */}
      <div className="flex flex-wrap items-center gap-1 mb-2 text-[11px]">
        {sorted.map((z) => (
          <div
            key={z.zone_id}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-[2px] shadow-sm"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: getTownDotColor(z.zone_name) }}
            />
            <span className="font-semibold text-gray-800">
              {z.zone_name}
            </span>
            <span className="text-[10px] text-gray-500">
              {z.active_drivers}/{z.capacity_limit}
            </span>
          </div>
        ))}
        {sorted.length > 0 && (
          <span className="ml-2 text-[10px] text-gray-400">
            Total active {totalActive} / slots {totalSlots}
          </span>
        )}
      </div>

      {/* Cards for each zone */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {sorted.map((z) => {
          const status = (z.status ?? "").toUpperCase();
          const borderClass = getStatusBorderClass(status);
          const util =
            z.capacity_limit > 0
              ? (z.active_drivers / z.capacity_limit) * 100
              : 0;

          return (
            <div
              key={z.zone_id}
              className={
                "border rounded-lg bg-white shadow-sm px-3 py-2 text-[11px] " +
                borderClass
              }
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full mt-[1px]"
                    style={{ backgroundColor: getTownDotColor(z.zone_name) }}
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-800">
                      {z.zone_name}
                    </span>
                    <span className="text-[9px] text-gray-400">
                      ID: {z.zone_id.slice(0, 4)}...
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-emerald-600">
                  {status || "AVAILABLE"}
                </span>
              </div>

              <div className="space-y-[2px] text-[10px] text-gray-600 mb-1">
                <div className="flex justify-between">
                  <span>Limit:</span>
                  <span>{z.capacity_limit}</span>
                </div>
                <div className="flex justify-between">
                  <span>Active:</span>
                  <span>{z.active_drivers}</span>
                </div>
                <div className="flex justify-between">
                  <span>Slots:</span>
                  <span>{z.available_slots}</span>
                </div>
              </div>

              <div className="mt-1 text-[10px] text-gray-500">
                {util.toFixed(0)}% used
              </div>

              <div className="mt-1">
                <button
                  type="button"
                  className="w-full rounded-md bg-emerald-500 text-white text-[10px] py-[4px] font-semibold hover:bg-emerald-600"
                >
                  AVAILABLE
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
