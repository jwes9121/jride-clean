"use client";

import { useEffect, useMemo, useState } from "react";

type DispatchRow = {
  booking_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  status: string | null;
  created_at: string | null;
  passenger_name: string | null;
  driver_name: string | null;
  vehicle_type: string | null;
  plate_number: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_status: string | null;
};

type ApiResponse =
  | {
      ok: true;
      rows: DispatchRow[];
    }
  | {
      ok: false;
      error: string;
      message?: string;
      details?: unknown;
    };

type TripStatus = "new" | "assigned" | "on_trip";

type TripItem = {
  id: string;
  code: string;
  passenger: string;
  from: string;
  to: string;
  note?: string;
  town: string;
  status: TripStatus;
  minutesAgo: number;
};

const demoTrips: TripItem[] = [
  {
    id: "JR-2025-0001",
    code: "JR-2025-0001",
    passenger: "Maria - Lagawe",
    from: "Ifugao State University, Lagawe",
    to: "Poblacion West, Lagawe",
    note: "With groceries",
    town: "Lagawe",
    status: "new",
    minutesAgo: 2,
  },
  {
    id: "JR-2025-0002",
    code: "JR-2025-0002",
    passenger: "Joshua - Kiangan",
    from: "Public Market, Kiangan",
    to: "Poblacion, Kiangan",
    town: "Kiangan",
    status: "new",
    minutesAgo: 5,
  },
  {
    id: "JR-2025-0003",
    code: "JR-2025-0003",
    passenger: "Lyn - Banaue",
    from: "Tourist Center, Banaue",
    to: "View Deck, Banaue",
    town: "Banaue",
    status: "assigned",
    minutesAgo: 10,
  },
  {
    id: "JR-2025-0004",
    code: "JR-2025-0004",
    passenger: "Carlo - Lamut",
    from: "ISU Lamut Campus",
    to: "Town Proper, Lamut",
    town: "Lamut",
    status: "on_trip",
    minutesAgo: 15,
  },
];

type DriverStatusKey = "online" | "on_trip" | "idle" | "offline" | "unknown";

function normalizeDriverStatus(raw: string | null): DriverStatusKey {
  if (!raw) return "unknown";
  const s = raw.toLowerCase();
  if (s.includes("online") || s === "ready") return "online";
  if (s.includes("trip") || s === "on_trip") return "on_trip";
  if (s.includes("idle")) return "idle";
  if (s.includes("offline") || s.includes("last_seen")) return "offline";
  return "unknown";
}

function statusLabel(key: DriverStatusKey): string {
  switch (key) {
    case "online":
      return "Online & ready";
    case "on_trip":
      return "On trip";
    case "idle":
      return "Idle";
    case "offline":
      return "Offline / last seen";
    default:
      return "Unknown";
  }
}

function statusDotColor(key: DriverStatusKey): string {
  switch (key) {
    case "online":
      return "bg-emerald-500";
    case "on_trip":
      return "bg-amber-500";
    case "idle":
      return "bg-sky-400";
    case "offline":
      return "bg-gray-400";
    default:
      return "bg-gray-300";
  }
}

function statusChipColor(key: DriverStatusKey): string {
  switch (key) {
    case "online":
      return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    case "on_trip":
      return "bg-amber-50 text-amber-700 border border-amber-200";
    case "idle":
      return "bg-sky-50 text-sky-700 border border-sky-200";
    case "offline":
      return "bg-gray-50 text-gray-600 border border-gray-200";
    default:
      return "bg-gray-50 text-gray-600 border border-gray-200";
  }
}

export default function DispatchPage() {
  const [drivers, setDrivers] = useState<DispatchRow[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState<boolean>(true);
  const [driverError, setDriverError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [selectedTrip, setSelectedTrip] = useState<TripItem | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<DispatchRow | null>(null);

  async function fetchDrivers() {
    try {
      setDriverError(null);
      const res = await fetch("/api/dispatch/overview", {
        method: "GET",
        cache: "no-store",
      });
      const data: ApiResponse = await res.json();

      if (!res.ok || data.ok === false) {
        const msg =
          (data as any).message ||
          (data as any).error ||
          "Failed to load JRidah list";
        setDriverError(msg);
        return;
      }

      const rows = (data as any).rows ?? [];
      setDrivers(rows);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Error fetching dispatch overview:", err);
      setDriverError("Unexpected error while loading JRidah list");
    } finally {
      setLoadingDrivers(false);
    }
  }

  useEffect(() => {
    fetchDrivers();
    const interval = setInterval(() => {
      fetchDrivers();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const driverSummary = useMemo(() => {
    const base = {
      online: 0,
      on_trip: 0,
      idle: 0,
      offline: 0,
      unknown: 0,
    };
    for (const d of drivers) {
      const key = normalizeDriverStatus(d.driver_status);
      (base as any)[key] = (base as any)[key] + 1;
    }
    return base;
  }, [drivers]);

  const countsLabel = {
    online: "Online",
    on_trip: "On trip",
    idle: "Idle",
    offline: "Offline",
  } as const;

  const activeTripsCount = useMemo(() => {
    return demoTrips.filter((t) => t.status !== "new").length;
  }, []);

  function handleAssignClick() {
    if (!selectedTrip || !selectedDriver) return;
    alert(
      `Assigning ${selectedTrip.code} to driver (status=${selectedDriver.driver_status || "?"}).` +
        "\n\nLater this will call your Supabase RPC for assignment."
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
              JRide Dispatch Console
            </h1>
            <p className="text-xs md:text-sm text-slate-500">
              Real-time control for trip assignment and JRidah coordination.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Live connection (demo layout)
            </span>
            {lastUpdated && (
              <span className="hidden md:inline text-[11px]">
                Last updated: {lastUpdated}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4 space-y-3">
        {/* Top summary chips */}
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Online: {driverSummary.online}
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            On trip: {driverSummary.on_trip}
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            Idle: {driverSummary.idle}
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Offline: {driverSummary.offline}
          </div>

          <div className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            Active trips: {activeTripsCount}
          </div>
        </div>

        {/* Main 3-column layout */}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1.8fr)_minmax(0,1.35fr)]">
          {/* Trip queue */}
          <section className="bg-white border border-slate-100 rounded-2xl shadow-sm flex flex-col">
            <header className="px-4 pt-4 pb-2 border-b border-slate-100">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-slate-800">Trip queue</div>
                  <div className="text-[11px] text-slate-500">
                    Pending: {demoTrips.filter((t) => t.status === "new").length} ·
                    Assigned:{" "}
                    {demoTrips.filter((t) => t.status === "assigned").length}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <input
                  type="text"
                  placeholder="Search trips by ID, rider, pickup..."
                  className="w-full rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                />
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-2 py-3 space-y-3 text-xs">
              <div>
                <div className="px-2 pb-1 text-[11px] font-semibold text-slate-500">
                  New requests
                </div>
                <div className="space-y-2">
                  {demoTrips
                    .filter((t) => t.status === "new")
                    .map((trip) => (
                      <button
                        key={trip.id}
                        onClick={() => setSelectedTrip(trip)}
                        className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                          selectedTrip?.id === trip.id
                            ? "border-amber-400 bg-amber-50"
                            : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[11px] text-slate-700">
                            {trip.code}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {trip.minutesAgo} min ago
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-700">
                          {trip.passenger}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          From: {trip.from}
                          <br />
                          To: {trip.to}
                        </div>
                        {trip.note && (
                          <div className="mt-1 text-[10px] text-slate-500">
                            Note: {trip.note}
                          </div>
                        )}
                      </button>
                    ))}
                </div>
              </div>

              <div>
                <div className="px-2 pb-1 text-[11px] font-semibold text-slate-500">
                  Assigned / on the way
                </div>
                <div className="space-y-2">
                  {demoTrips
                    .filter((t) => t.status === "assigned")
                    .map((trip) => (
                      <button
                        key={trip.id}
                        onClick={() => setSelectedTrip(trip)}
                        className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                          selectedTrip?.id === trip.id
                            ? "border-sky-400 bg-sky-50"
                            : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[11px] text-slate-700">
                            {trip.code}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {trip.minutesAgo} min ago
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-700">
                          {trip.passenger}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          From: {trip.from}
                          <br />
                          To: {trip.to}
                        </div>
                      </button>
                    ))}
                </div>
              </div>

              <div>
                <div className="px-2 pb-1 text-[11px] font-semibold text-slate-500">
                  On trip
                </div>
                <div className="space-y-2">
                  {demoTrips
                    .filter((t) => t.status === "on_trip")
                    .map((trip) => (
                      <button
                        key={trip.id}
                        onClick={() => setSelectedTrip(trip)}
                        className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                          selectedTrip?.id === trip.id
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[11px] text-slate-700">
                            {trip.code}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {trip.minutesAgo} min ago
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-700">
                          {trip.passenger}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          From: {trip.from}
                          <br />
                          To: {trip.to}
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </section>

          {/* Assignment panel + map placeholder */}
          <section className="bg-white border border-slate-100 rounded-2xl shadow-sm flex flex-col">
            <header className="px-4 pt-4 pb-2 border-b border-slate-100 flex items-center justify-between text-xs">
              <div className="font-semibold text-slate-800">Assignment panel</div>
              <button
                onClick={handleAssignClick}
                disabled={!selectedTrip || !selectedDriver}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                  !selectedTrip || !selectedDriver
                    ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                    : "bg-amber-500 text-white hover:bg-amber-600"
                }`}
              >
                Assign trip
              </button>
            </header>

            <div className="px-4 py-3 grid gap-3 text-xs md:grid-cols-2 border-b border-slate-100">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold text-slate-600 mb-1">
                  Selected trip
                </div>
                {selectedTrip ? (
                  <div className="space-y-1 text-[11px]">
                    <div className="font-semibold text-slate-800">
                      {selectedTrip.code} · {selectedTrip.passenger}
                    </div>
                    <div className="text-slate-600">
                      From: {selectedTrip.from}
                      <br />
                      To: {selectedTrip.to}
                    </div>
                    {selectedTrip.note && (
                      <div className="text-slate-500">Note: {selectedTrip.note}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    Click a trip on the left to view its details and prepare for
                    assignment.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold text-slate-600 mb-1">
                  Selected JRidah
                </div>
                {selectedDriver ? (
                  <div className="space-y-1 text-[11px]">
                    <div className="font-semibold text-slate-800">
                      {selectedDriver.driver_name || "Unnamed JRidah"}
                    </div>
                    <div className="text-slate-600 text-[11px]">
                      Status:{" "}
                      {statusLabel(
                        normalizeDriverStatus(selectedDriver.driver_status)
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    Click a driver on the right to select them for this assignment.
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 px-4 pb-4 pt-3">
              <div className="h-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-[11px] text-slate-500">
                <div className="uppercase tracking-wide text-[10px] text-slate-400 mb-1">
                  Operational map
                </div>
                <p className="max-w-xs text-center">
                  This box is a placeholder for the live Mapbox view. Later, mount
                  your LiveDriverMap component here and center on the selected trip
                  pickup and nearby JRidahs.
                </p>
              </div>
            </div>
          </section>

          {/* JRidah list */}
          <section className="bg-white border border-slate-100 rounded-2xl shadow-sm flex flex-col">
            <header className="px-4 pt-4 pb-2 border-b border-slate-100 flex items-center justify-between text-xs">
              <div>
                <div className="font-semibold text-slate-800">JRidah list</div>
                <div className="text-[11px] text-slate-500">
                  {drivers.length} drivers
                </div>
              </div>
              <div className="text-[11px] text-slate-500">
                Focus area: <span className="font-semibold">All municipalities</span>
              </div>
            </header>

            <div className="px-4 pt-3">
              <input
                type="text"
                placeholder="Search by name, ID, callsign..."
                className="w-full rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
            </div>

            {driverError && (
              <div className="px-4 pt-2 text-[11px] text-red-600">
                Error: {driverError}
              </div>
            )}

            {loadingDrivers && !driverError && (
              <div className="px-4 pt-3 text-[11px] text-slate-500">
                Loading JRidah list…
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-2 py-3 space-y-2 text-xs">
              {drivers.length === 0 && !loadingDrivers && !driverError && (
                <div className="px-3 py-2 text-[11px] text-slate-500 border border-dashed border-slate-200 rounded-xl">
                  No drivers in dispatch_rides_view yet. Once driver_locations has
                  rows, they will appear here.
                </div>
              )}

              {drivers.map((d, index) => {
                const key = normalizeDriverStatus(d.driver_status);
                const isSelected =
                  selectedDriver?.driver_lat === d.driver_lat &&
                  selectedDriver?.driver_lng === d.driver_lng &&
                  selectedDriver?.driver_status === d.driver_status;

                return (
                  <button
                    key={index}
                    onClick={() => setSelectedDriver(d)}
                    className={`w-full text-left rounded-xl border px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? "border-amber-400 bg-amber-50"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full border border-white shadow-sm inline-block">
                          <span
                            className={`block h-2 w-2 rounded-full ${statusDotColor(
                              key
                            )}`}
                          />
                        <div className="flex flex-col">
  <span className="font-semibold text-[12px] text-slate-800">
    {d.driver_name || d.callsign || "JRidah"}
  </span>

  <span className="text-[10px] text-slate-500">
    {d.callsign ? `${d.callsign} • ${d.municipality ?? ""}` : ""}
  </span>
</div>

                    <div
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusChipColor(
                        key
                      )}`}
                    >
                      {statusLabel(key)}
                    </div>
                  </button>
                );
              })}
            </div>

            <footer className="border-t border-slate-100 px-4 py-3 text-[10px] text-slate-500">
              <div>Dispatcher shortcuts (future idea)</div>
              <ul className="mt-1 space-y-0.5">
                <li>• Click trip → centers map & shows best JRidahs.</li>
                <li>• Click driver → selects for assignment.</li>
                <li>
                  • Assign trip button → call your Supabase RPC (assign_nearest / etc.).
                </li>
              </ul>
            </footer>
          </section>
        </div>
      </main>
    </div>
  );
}
