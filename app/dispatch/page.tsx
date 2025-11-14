"use client";

import { useMemo, useState } from "react";

type TripStatus = "pending" | "assigned" | "on_trip" | "completed" | "cancelled";

type Municipality = "Lagawe" | "Kiangan" | "Banaue" | "Lamut" | "Hingyon";

interface Trip {
  id: string;
  riderName: string;
  pickup: string;
  dropoff: string;
  municipality: Municipality;
  requestedAt: string; // e.g. "2 min ago"
  status: TripStatus;
  notes?: string;
}

interface Driver {
  id: string;
  name: string;
  callsign: string;
  municipality: Municipality;
  status: "online" | "on_trip" | "idle" | "offline";
  lastSeen: string; // e.g. "30s ago"
  currentTripId?: string;
}

const MOCK_TRIPS: Trip[] = [
  {
    id: "JR-2025-0001",
    riderName: "Maria",
    pickup: "Ifugao State University, Lagawe",
    dropoff: "Poblacion West, Lagawe",
    municipality: "Lagawe",
    requestedAt: "2 min ago",
    status: "pending",
    notes: "With groceries",
  },
  {
    id: "JR-2025-0002",
    riderName: "Joshua",
    pickup: "Public Market, Kiangan",
    dropoff: "Poblacion, Kiangan",
    municipality: "Kiangan",
    requestedAt: "5 min ago",
    status: "pending",
  },
  {
    id: "JR-2025-0003",
    riderName: "Lyn",
    pickup: "Tourist Center, Banaue",
    dropoff: "View Deck, Banaue",
    municipality: "Banaue",
    requestedAt: "10 min ago",
    status: "assigned",
  },
  {
    id: "JR-2025-0004",
    riderName: "Carlo",
    pickup: "ISU Lamut Campus",
    dropoff: "Town Proper, Lamut",
    municipality: "Lamut",
    requestedAt: "15 min ago",
    status: "on_trip",
  },
];

const MOCK_DRIVERS: Driver[] = [
  {
    id: "JRIDAH-001",
    name: "Arnold",
    callsign: "JR-LAG-001",
    municipality: "Lagawe",
    status: "online",
    lastSeen: "18s ago",
  },
  {
    id: "JRIDAH-002",
    name: "Brian",
    callsign: "JR-LAG-002",
    municipality: "Lagawe",
    status: "idle",
    lastSeen: "45s ago",
  },
  {
    id: "JRIDAH-010",
    name: "Kim",
    callsign: "JR-KIA-010",
    municipality: "Kiangan",
    status: "online",
    lastSeen: "30s ago",
  },
  {
    id: "JRIDAH-021",
    name: "Leo",
    callsign: "JR-BAN-021",
    municipality: "Banaue",
    status: "on_trip",
    lastSeen: "1 min ago",
    currentTripId: "JR-2025-0003",
  },
  {
    id: "JRIDAH-030",
    name: "Mia",
    callsign: "JR-LAM-030",
    municipality: "Lamut",
    status: "on_trip",
    lastSeen: "2 min ago",
    currentTripId: "JR-2025-0004",
  },
  {
    id: "JRIDAH-050",
    name: "Noel",
    callsign: "JR-HIN-050",
    municipality: "Hingyon",
    status: "offline",
    lastSeen: "1 hr ago",
  },
];

const MUNICIPALITIES: Municipality[] = ["Lagawe", "Kiangan", "Banaue", "Lamut", "Hingyon"];

function getTripStatusLabel(status: TripStatus): string {
  switch (status) {
    case "pending":
      return "Searching / Unassigned";
    case "assigned":
      return "Assigned";
    case "on_trip":
      return "On Trip";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function getTripStatusClasses(status: TripStatus): string {
  switch (status) {
    case "pending":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "assigned":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "on_trip":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "completed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelled":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-gray-50 text-gray-700 border-gray-200";
  }
}

function getDriverStatusLabel(status: Driver["status"]): string {
  switch (status) {
    case "online":
      return "Online & ready";
    case "on_trip":
      return "On trip";
    case "idle":
      return "Idle";
    case "offline":
      return "Offline";
    default:
      return status;
  }
}

function getDriverStatusDotClasses(status: Driver["status"]): string {
  switch (status) {
    case "online":
      return "bg-emerald-500";
    case "on_trip":
      return "bg-blue-500";
    case "idle":
      return "bg-amber-400";
    case "offline":
      return "bg-slate-400";
    default:
      return "bg-slate-400";
  }
}

export default function DispatchPage() {
  const [tripSearch, setTripSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [municipalityFilter, setMunicipalityFilter] = useState<Municipality | "All">("All");

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  const trips = MOCK_TRIPS;
  const drivers = MOCK_DRIVERS;

  const selectedTrip = useMemo(
    () => trips.find((t) => t.id === selectedTripId) || null,
    [selectedTripId, trips]
  );

  const selectedDriver = useMemo(
    () => drivers.find((d) => d.id === selectedDriverId) || null,
    [selectedDriverId, drivers]
  );

  const filteredTrips = useMemo(() => {
    return trips.filter((trip) => {
      if (municipalityFilter !== "All" && trip.municipality !== municipalityFilter) return false;
      if (!tripSearch.trim()) return true;
      const q = tripSearch.toLowerCase();
      return (
        trip.id.toLowerCase().includes(q) ||
        trip.riderName.toLowerCase().includes(q) ||
        trip.pickup.toLowerCase().includes(q) ||
        trip.dropoff.toLowerCase().includes(q)
      );
    });
  }, [trips, tripSearch, municipalityFilter]);

  const filteredDrivers = useMemo(() => {
    return drivers.filter((driver) => {
      if (municipalityFilter !== "All" && driver.municipality !== municipalityFilter) return false;
      if (!driverSearch.trim()) return true;
      const q = driverSearch.toLowerCase();
      return (
        driver.id.toLowerCase().includes(q) ||
        driver.name.toLowerCase().includes(q) ||
        driver.callsign.toLowerCase().includes(q)
      );
    });
  }, [drivers, driverSearch, municipalityFilter]);

  const pendingTrips = filteredTrips.filter((t) => t.status === "pending");
  const assignedTrips = filteredTrips.filter((t) => t.status === "assigned");
  const onTripTrips = filteredTrips.filter((t) => t.status === "on_trip");

  function handleSelectTrip(trip: Trip) {
    setSelectedTripId(trip.id);
  }

  function handleSelectDriver(driver: Driver) {
    setSelectedDriverId(driver.id);
  }

  function handleAssignClick() {
    if (!selectedTrip || !selectedDriver) return;

    // For now, just show a browser confirm.
    // Later you will replace this with a Supabase RPC / API call.
    const ok = window.confirm(
      `Assign Trip ${selectedTrip.id} (${selectedTrip.pickup} → ${selectedTrip.dropoff}) to ${selectedDriver.name} (${selectedDriver.callsign})?`
    );
    if (ok) {
      // No real backend update yet – this is just a UI layout.
      window.alert("Assignment action placeholder – wire this to Supabase / assign_nearest RPC.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
              JRide Dispatch Console
            </h1>
            <p className="text-xs text-slate-500 sm:text-sm">
              Real-time control for trip assignment and JRidah coordination.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 sm:flex">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Live connection (demo layout)
            </div>
          </div>
        </div>
      </header>

      {/* Filters / summary */}
      <section className="border-b border-slate-200 bg-slate-50/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
              🟢 Online: {drivers.filter((d) => d.status === "online").length}
            </span>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">
              🔵 On trip: {drivers.filter((d) => d.status === "on_trip").length}
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
              🟡 Idle: {drivers.filter((d) => d.status === "idle").length}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
              ⚪ Offline: {drivers.filter((d) => d.status === "offline").length}
            </span>
            <span className="ml-2 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white">
              Active trips: {onTripTrips.length + assignedTrips.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-600 sm:text-sm">
              <span className="hidden sm:inline">Focus area:</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 sm:text-sm"
                value={municipalityFilter}
                onChange={(e) => setMunicipalityFilter(e.target.value as Municipality | "All")}
              >
                <option value="All">All municipalities</option>
                {MUNICIPALITIES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* Main 3-column layout */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 lg:flex-row">
        {/* LEFT: Trip queue */}
        <section className="flex w-full flex-col gap-3 lg:w-[32%]">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Trip queue</h2>
              <span className="text-xs text-slate-500">
                Pending: {pendingTrips.length} • Assigned: {assignedTrips.length}
              </span>
            </div>
            <div className="mb-2">
              <input
                value={tripSearch}
                onChange={(e) => setTripSearch(e.target.value)}
                placeholder="Search trips by ID, rider, pickup..."
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-slate-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>

            {/* Pending */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">🟠 New requests</span>
                <span className="text-slate-400">{pendingTrips.length}</span>
              </div>
              <div className="space-y-2">
                {pendingTrips.length === 0 && (
                  <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50 px-2 py-3 text-xs text-amber-700">
                    No unassigned trips right now.
                  </div>
                )}
                {pendingTrips.map((trip) => (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => handleSelectTrip(trip)}
                    className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition hover:border-slate-400 hover:bg-slate-50 ${
                      selectedTripId === trip.id ? "border-slate-800 bg-slate-900 text-white" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{trip.id}</span>
                      <span className={selectedTripId === trip.id ? "text-slate-200" : "text-slate-400"}>
                        {trip.requestedAt}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5">
                      <div className="truncate">
                        <span className="font-medium">
                          {trip.riderName} • {trip.municipality}
                        </span>
                      </div>
                      <div className={selectedTripId === trip.id ? "text-slate-200" : "text-slate-500"}>
                        <span className="font-semibold">From:</span> {trip.pickup}
                      </div>
                      <div className={selectedTripId === trip.id ? "text-slate-200" : "text-slate-500"}>
                        <span className="font-semibold">To:</span> {trip.dropoff}
                      </div>
                      {trip.notes && (
                        <div
                          className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 ${
                            selectedTripId === trip.id
                              ? "bg-slate-800 text-slate-100"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          Note: {trip.notes}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Assigned */}
            <div className="mb-3 border-t border-slate-100 pt-2">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">🔵 Assigned / on the way</span>
                <span className="text-slate-400">{assignedTrips.length}</span>
              </div>
              <div className="space-y-2">
                {assignedTrips.map((trip) => (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => handleSelectTrip(trip)}
                    className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition hover:border-slate-400 hover:bg-slate-50 ${
                      selectedTripId === trip.id ? "border-slate-800 bg-slate-900 text-white" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{trip.id}</span>
                      <span className={selectedTripId === trip.id ? "text-slate-200" : "text-slate-400"}>
                        {trip.requestedAt}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5">
                      <div className="truncate">
                        <span className="font-medium">
                          {trip.riderName} • {trip.municipality}
                        </span>
                      </div>
                      <div className={selectedTripId === trip.id ? "text-slate-200" : "text-slate-500"}>
                        <span className="font-semibold">From:</span> {trip.pickup}
                      </div>
                      <div className={selectedTripId === trip.id ? "text-slate-200" : "text-slate-500"}>
                        <span className="font-semibold">To:</span> {trip.dropoff}
                      </div>
                    </div>
                  </button>
                ))}
                {assignedTrips.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-3 text-xs text-slate-500">
                    No assigned trips in this area.
                  </div>
                )}
              </div>
            </div>

            {/* On trip */}
            <div className="border-t border-slate-100 pt-2">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">🚕 On trip</span>
                <span className="text-slate-400">{onTripTrips.length}</span>
              </div>
              <div className="space-y-2">
                {onTripTrips.map((trip) => (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => handleSelectTrip(trip)}
                    className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition hover:border-slate-400 hover:bg-slate-50 ${
                      selectedTripId === trip.id ? "border-slate-800 bg-slate-900 text-white" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{trip.id}</span>
                      <span className={selectedTripId === trip.id ? "text-slate-200" : "text-slate-400"}>
                        {trip.requestedAt}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5">
                      <div className="truncate">
                        <span className="font-medium">
                          {trip.riderName} • {trip.municipality}
                        </span>
                      </div>
                      <div className={selectedTripId === trip.id ? "text-slate-200" : "text-slate-500"}>
                        <span className="font-semibold">From:</span> {trip.pickup}
                      </div>
                      <div className={selectedTripId === trip.id ? "text-slate-200" : "text-slate-500"}>
                        <span className="font-semibold">To:</span> {trip.dropoff}
                      </div>
                    </div>
                  </button>
                ))}
                {onTripTrips.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-3 text-xs text-slate-500">
                    No active trips on the road.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* CENTER: Map / trip + driver summary */}
        <section className="mb-4 flex w-full flex-col gap-3 lg:mb-0 lg:w-[40%]">
          {/* Trip + driver summary / assign bar */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Assignment panel</h2>
              <button
                type="button"
                onClick={handleAssignClick}
                disabled={!selectedTrip || !selectedDriver}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
                  selectedTrip && selectedDriver
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "cursor-not-allowed bg-slate-200 text-slate-500"
                }`}
              >
                Assign trip
              </button>
            </div>

            <div className="grid gap-2 text-xs sm:grid-cols-2">
              {/* Selected trip */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Selected trip</span>
                  {selectedTrip ? (
                    <span
                      className={
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                        getTripStatusClasses(selectedTrip.status)
                      }
                    >
                      {getTripStatusLabel(selectedTrip.status)}
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">None</span>
                  )}
                </div>
                {selectedTrip ? (
                  <div className="space-y-0.5 text-slate-700">
                    <div className="font-medium">
                      {selectedTrip.id} • {selectedTrip.riderName}
                    </div>
                    <div>
                      <span className="font-semibold">From:</span> {selectedTrip.pickup}
                    </div>
                    <div>
                      <span className="font-semibold">To:</span> {selectedTrip.dropoff}
                    </div>
                    <div className="text-slate-500">Requested {selectedTrip.requestedAt}</div>
                    {selectedTrip.notes && (
                      <div className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                        Note: {selectedTrip.notes}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Click a trip on the left to view its details and prepare for assignment.
                  </p>
                )}
              </div>

              {/* Selected driver */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Selected JRidah</span>
                  {selectedDriver ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${getDriverStatusDotClasses(selectedDriver.status)}`} />
                      {getDriverStatusLabel(selectedDriver.status)}
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">None</span>
                  )}
                </div>
                {selectedDriver ? (
                  <div className="space-y-0.5 text-slate-700">
                    <div className="font-medium">
                      {selectedDriver.name} • {selectedDriver.callsign}
                    </div>
                    <div className="text-slate-600">
                      Municipality: <span className="font-semibold">{selectedDriver.municipality}</span>
                    </div>
                    <div className="text-slate-600">
                      Last seen: <span className="font-semibold">{selectedDriver.lastSeen}</span>
                    </div>
                    {selectedDriver.currentTripId && (
                      <div className="text-slate-600">
                        On trip: <span className="font-semibold">{selectedDriver.currentTripId}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Click a driver on the right to select them for this assignment.
                  </p>
                )}
              </div>
            </div>

            {!selectedTrip && (
              <div className="mt-2 rounded-md border border-dashed border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                Tip: start from a <span className="font-semibold">New request</span> on the left, then pick the best JRidah on the
                right.
              </div>
            )}
          </div>

          {/* Map placeholder / instructions */}
          <div className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Operational map</h2>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                Placeholder – hook to Mapbox later
              </span>
            </div>
            <div className="relative flex flex-1 items-center justify-center rounded-lg border border-slate-200 bg-slate-100">
              <div className="pointer-events-none absolute inset-0 rounded-lg border border-dashed border-slate-300" />
              <div className="mx-auto max-w-xs text-center text-xs text-slate-600">
                This box is a placeholder for the live Mapbox view.
                <br />
                Later, mount your <span className="font-semibold">LiveDriverMap</span> component here and center on the selected trip
                pickup and nearby JRidahs.
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-600 sm:grid-cols-4">
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Online & ready
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> On trip
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Idle
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-slate-400" /> Offline / last seen
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT: Driver list */}
        <section className="flex w-full flex-col gap-3 lg:w-[28%]">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">JRidah list</h2>
              <span className="text-xs text-slate-500">{filteredDrivers.length} drivers</span>
            </div>

            <div className="mb-2 flex items-center gap-2">
              <input
                value={driverSearch}
                onChange={(e) => setDriverSearch(e.target.value)}
                placeholder="Search by name, ID, callsign..."
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-slate-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>

            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1 text-xs">
              {filteredDrivers.map((driver) => (
                <button
                  key={driver.id}
                  type="button"
                  onClick={() => handleSelectDriver(driver)}
                  className={`flex w-full flex-col rounded-lg border px-2 py-2 text-left transition hover:border-slate-400 hover:bg-slate-50 ${
                    selectedDriverId === driver.id
                      ? "border-slate-800 bg-slate-900 text-white"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${getDriverStatusDotClasses(driver.status)}`}
                      />
                      <span className="font-semibold">
                        {driver.name} • {driver.callsign}
                      </span>
                    </div>
                    <span className={selectedDriverId === driver.id ? "text-slate-200" : "text-slate-400"}>{driver.lastSeen}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className={selectedDriverId === driver.id ? "text-slate-200" : "text-slate-500"}>
                      {driver.municipality}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        selectedDriverId === driver.id
                          ? "bg-slate-800 text-slate-100"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {getDriverStatusLabel(driver.status)}
                    </span>
                  </div>
                  {driver.currentTripId && (
                    <div className={selectedDriverId === driver.id ? "mt-1 text-slate-200" : "mt-1 text-slate-500"}>
                      Trip: <span className="font-semibold">{driver.currentTripId}</span>
                    </div>
                  )}
                </button>
              ))}

              {filteredDrivers.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-3 text-xs text-slate-500">
                  No drivers match this filter.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-100 p-3 text-[11px] text-slate-600">
            <div className="mb-1 font-semibold text-slate-800">Dispatcher shortcuts (future idea)</div>
            <ul className="space-y-0.5">
              <li>
                • <span className="font-semibold">Click trip</span> → centers map & shows best JRidahs.
              </li>
              <li>
                • <span className="font-semibold">Click driver</span> → selects for assignment.
              </li>
              <li>
                • <span className="font-semibold">Assign trip</span> button → call your Supabase RPC.
              </li>
              <li>• Later you can add keyboard shortcuts (A = assign, R = reassign, C = cancel).</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
