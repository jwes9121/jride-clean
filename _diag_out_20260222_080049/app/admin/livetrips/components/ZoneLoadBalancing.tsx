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

type ZoneAlert = {
  zone: ZoneCapacityItem;
  utilization: number;
  level: "OK" | "WATCH" | "CRITICAL";
  message: string;
};

function buildAlerts(zones: ZoneCapacityItem[]): ZoneAlert[] {
  if (!zones || zones.length === 0) return [];

  return zones.map((z) => {
    const utilization =
      z.capacity_limit > 0 ? z.active_drivers / z.capacity_limit : 0;

    let level: ZoneAlert["level"] = "OK";
    let message = "Load is normal.";

    if (utilization >= 0.9) {
      level = "CRITICAL";
      message =
        "Very high load. Dispatcher should prioritize trips in this town and remind drivers to return to base promptly.";
    } else if (utilization >= 0.7) {
      level = "WATCH";
      message =
        "High load. Monitor this town. Avoid assigning long-distance trips that may reduce local availability.";
    }

    return {
      zone: z,
      utilization,
      level,
      message,
    };
  });
}

export default function ZoneLoadBalancing() {
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
        Calculating zone load status...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-2 text-xs text-red-500">
        Error loading zone capacity for monitoring.
      </div>
    );
  }

  const zones: ZoneCapacityItem[] = Array.isArray(data) ? data : [];
  const alerts = buildAlerts(zones);

  return (
    <div className="w-full mb-3">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Zone Load Monitoring (Per Town Only)
        </h2>
        <span className="text-[10px] text-gray-400">
          Ordinance: Drivers cannot be moved between municipalities.
        </span>
      </div>

      {alerts.length === 0 ? (
        <div className="text-[11px] text-gray-500 border rounded-md px-3 py-2 bg-gray-50">
          No zones configured yet.
        </div>
      ) : (
        <div className="border rounded-md bg-white shadow-sm">
          <div className="grid grid-cols-4 gap-2 text-[10px] font-semibold text-gray-500 border-b px-3 py-2">
            <div>Town / Zone</div>
            <div className="text-center">Utilization</div>
            <div className="text-center">Status</div>
            <div className="text-right">Dispatcher Notes</div>
          </div>
          <div className="divide-y text-[11px]">
            {alerts.map((a) => {
              const utilPct = (a.utilization * 100).toFixed(0);
              let badgeClass =
                "inline-flex items-center justify-center px-2 py-[2px] rounded-full text-[10px] font-semibold ";

              if (a.level === "CRITICAL") {
                badgeClass += "bg-red-500 text-white";
              } else if (a.level === "WATCH") {
                badgeClass += "bg-yellow-400 text-black";
              } else {
                badgeClass += "bg-emerald-500 text-white";
              }

              return (
                <div
                  key={a.zone.zone_id}
                  className="grid grid-cols-4 gap-2 px-3 py-2 items-center"
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-gray-800">
                      {a.zone.zone_name}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {a.zone.active_drivers}/{a.zone.capacity_limit} drivers
                    </span>
                  </div>

                  <div className="text-center text-[10px] text-gray-700">
                    {utilPct}% used ({a.zone.available_slots} slots free)
                  </div>

                  <div className="text-center">
                    <span className={badgeClass}>{a.level}</span>
                  </div>

                  <div className="text-right text-[10px] text-gray-600">
                    {a.message}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-1 text-[10px] text-gray-400">
        This panel is for monitoring only. It does NOT move drivers between
        towns. Dispatchers must respect each driver's home municipality: drivers
        may drop off passengers in other towns but can only pick up passengers
        in their own town.
      </p>
    </div>
  );
}
