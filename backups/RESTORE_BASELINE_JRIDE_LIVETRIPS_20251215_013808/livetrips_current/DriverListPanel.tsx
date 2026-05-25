"use client";

import { useEffect, useState } from "react";
import classNames from "classnames";
import { supabase } from "@/lib/supabaseClient";

export type Driver = {
  id: string;
  name: string;
  status: "online" | "on_trip" | "offline";
  town: string | null;
  updatedAt: string | null;
};

type TownGroup = {
  town: string;
  drivers: Driver[];
};

const TOWN_COLORS: Record<string, string> = {
  Lagawe: "bg-maroon-600 text-white", // adjust to your real Tailwind colors
  Banaue: "bg-yellow-500 text-black",
  Kiangan: "bg-green-500 text-white",
  Lamut: "bg-yellow-300 text-black",
};

const STATUS_LABEL: Record<Driver["status"], string> = {
  online: "Available",
  on_trip: "On trip",
  offline: "Offline",
};

export default function DriverListPanel() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDrivers() {
      setLoading(true);
      const { data, error } = await supabase
        .from("driver_locations")
        .select(
          `
          driver_id,
          status,
          town,
          updated_at,
          driver_profiles:driver_id (
            full_name,
            municipality
          )
        `
        );

      if (cancelled) return;
      setLoading(false);

      if (error || !data) {
        console.error("Failed to load drivers", error);
        setDrivers([]);
        return;
      }

      const mapped: Driver[] = data.map((row: any) => {
        const townFromDb: string | null =
          row.town ??
          row.driver_profiles?.municipality ??
          null;

        return {
          id: row.driver_id,
          name: row.driver_profiles?.full_name || "Unnamed driver",
          status:
            (row.status as Driver["status"]) ??
            "offline",
          town: townFromDb,
          updatedAt: row.updated_at ?? null,
        };
      });

      setDrivers(mapped);
    }

    loadDrivers();

    // optional: you could add realtime subscription here later

    return () => {
      cancelled = true;
    };
  }, []);

  const total = drivers.length;
  const online = drivers.filter((d) => d.status === "online").length;
  const onTrip = drivers.filter((d) => d.status === "on_trip").length;
  const offline = total - online - onTrip;

  // group by town, put "Other" last
  const groups: TownGroup[] = (() => {
    const byTown: Record<string, Driver[]> = {};
    for (const d of drivers) {
      const key = d.town || "Other";
      if (!byTown[key]) byTown[key] = [];
      byTown[key].push(d);
    }
    const towns = Object.keys(byTown).sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });

    return towns.map((town) => ({
      town,
      drivers: byTown[town].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    }));
  })();

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-white">
      {/* Summary line */}
      <div className="px-3 py-2 text-xs font-medium border-b border-gray-200 bg-gray-50">
        <span className="mr-4">
          Total: <span className="font-bold">{total}</span>
        </span>
        <span className="mr-4 text-green-700">
          Online: <span className="font-bold">{online}</span>
        </span>
        <span className="mr-4 text-orange-700">
          On trip: <span className="font-bold">{onTrip}</span>
        </span>
        <span className="text-gray-600">
          Offline: <span className="font-bold">{offline}</span>
        </span>
      </div>

      {loading && (
        <div className="px-3 py-2 text-xs text-gray-500">
          Loading drivers…
        </div>
      )}

      {/* Town groups */}
      <div className="flex-1 overflow-y-auto text-xs">
        {groups.map((group) => {
          const townKey = group.town || "Other";
          const colorClass =
            TOWN_COLORS[townKey] ||
            "bg-gray-100 text-gray-800";

          return (
            <div key={townKey} className="border-b border-gray-100">
              <div
                className={classNames(
                  "px-3 py-1.5 font-semibold flex items-center justify-between",
                  colorClass
                )}
              >
                <span>{townKey}</span>
                <span className="text-[11px] opacity-80">
                  {group.drivers.length}{" "}
                  {group.drivers.length === 1
                    ? "driver"
                    : "drivers"}
                </span>
              </div>

              {group.drivers.map((driver) => (
                <div
                  key={driver.id}
                  className="px-3 py-2 flex items-center justify-between border-t border-gray-100 hover:bg-gray-50"
                >
                  <div className="flex items-center space-x-2">
                    {/* Status dot */}
                    <span
                      className={classNames(
                        "inline-flex h-2.5 w-2.5 rounded-full",
                        driver.status === "online" &&
                          "bg-green-500",
                        driver.status === "offline" &&
                          "bg-gray-400",
                        driver.status === "on_trip" &&
                          "bg-orange-500 animate-pulse"
                      )}
                    />

                    <div className="flex flex-col">
                      <span className="font-medium text-xs">
                        {driver.name}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        {STATUS_LABEL[driver.status]}
                      </span>
                    </div>
                  </div>

                  {/* Last update (simple text for now) */}
                  {driver.updatedAt && (
                    <span className="text-[11px] text-gray-400">
                      Updated:{" "}
                      {new Date(
                        driver.updatedAt
                      ).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        {!loading && groups.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-500">
            No drivers found.
          </div>
        )}
      </div>
    </div>
  );
}
