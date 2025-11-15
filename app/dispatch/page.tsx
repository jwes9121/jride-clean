"use client";

import { useEffect, useMemo, useState } from "react";

type DispatchRow = {
  driver_id: string | null;
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
  callsign: string | null;
  municipality: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_status: string | null;
};

type TripRow = {
  id: string;
  booking_code: string | null;
  passenger_name: string | null;
  from_label: string | null;
  to_label: string | null;
  town: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  status: string | null;
  created_at: string | null;
};

type ApiDriversResponse =
  | { ok: true; rows: DispatchRow[] }
  | { ok: false; error: string; message?: string; details?: unknown };

type ApiTripsResponse =
  | { ok: true; rows: TripRow[] }
  | { ok: false; error: string; message?: string; details?: unknown };

type TripStatus = "new" | "assigned" | "on_trip";

type DriverStatusKey = "online" | "on_trip" | "idle" | "offline" | "unknown";

function normalizeDriverStatus(raw: string | null): DriverStatusKey {
  if (!raw) return "unknown";
  const s = raw.toLowerCase();
  if (s.includes("trip") || s === "on_trip") return "on_trip";
  if (s.includes("idle")) return "idle";
  if (s.includes("offline") || s.includes("last")) return "offline";
  if (s.includes("online") || s === "ready") return "online";
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

function normalizeTripStatus(raw: string | null): TripStatus {
  const s = (raw || "").toLowerCase();
  if (s === "assigned") return "assigned";
  if (s === "on_trip" || s === "on-trip" || s === "on trip") return "on_trip";
  return "new";
}

function minutesAgo(created_at: string | null): number | null {
  if (!created_at) return null;
  const t = new Date(created_at).getTime();
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  const diffMin = Math.floor(diffMs / (1000 * 60));
  return diffMin < 0 ? 0 : diffMin;
}

export default function DispatchPage() {
  const [drivers, setDrivers] = useState<DispatchRow[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState<boolean>(true);
  const [driverError, setDriverError] = useState<string | null>(null);

  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loadingTrips, setLoadingTrips] = useState<boolean>(true);
  const [tripError, setTripError] = useState<string | null>(null);

  const [selectedTrip, setSelectedTrip] = useState<TripRow | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<DispatchRow | null>(null);

  const [assigning, setAssigning] = useState(false);

  async function fetchDrivers() {
    try {
      setDriverError(null);
      const res = await fetch("/api/dispatch/overview", {
        method: "GET",
        cache: "no-store",
      });
      const data: ApiDriversResponse = await res.json();

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
    } catch (err) {
      console.error("Error fetching dispatch overview:", err);
      setDriverError("Unexpected error while loading JRidah list");
    } finally {
      setLoadingDrivers(false);
    }
  }

  async function fetchTrips() {
    try {
      setTripError(null);
      const res = await fetch("/api/dispatch/trips", {
        method: "GET",
        cache: "no-store",
      });
      const data: ApiTripsResponse = await res.json();

      if (!res.ok || data.ok === false) {
        const msg =
          (data as any).message ||
          (data as any).error ||
          "Failed to load trip queue";
        setTripError(msg);
        return;
      }

      const rows = (data as any).rows ?? [];
      setTrips(rows);
    } catch (err) {
      console.error("Error fetching dispatch trips:", err);
      setTripError("Unexpected error while loading trip queue");
    } finally {
      setLoadingTrips(false);
    }
  }

  useEffect(() => {
    fetchDrivers();
    fetchTrips();

    const interval = setInterval(() => {
      fetchDrivers();
      fetchTrips();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  function handleAssignClick() {
    if (!selectedTrip || !selectedDriver) return;

    if (!selectedTrip.booking_code || !selectedDriver.driver_id) {
      alert("Missing booking or driver ID for assignment.");
      return;
    }

    setAssigning(true);

    fetch("/api/dispatch/assign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bookingCode: selectedTrip.booking_code,
        driverId: selectedDriver.driver_id,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) {
          alert("Assign failed: " + data.error);
        } else {
          alert("Trip assigned to driver successfully!");
          fetchTrips(); // Refresh trip list after assignment
        }
      })
      .catch((err) => {
        console.error("Assign failed", err);
        alert("Unexpected error while assigning trip.");
      })
      .finally(() => {
        setAssigning(false);
      });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Your layout and UI components */}
      <button
        onClick={handleAssignClick}
        disabled={assigning || !selectedTrip || !selectedDriver}
      >
        {assigning ? "Assigning..." : "Assign Trip"}
      </button>
      {/* Your UI elements for displaying trip and driver info */}
    </div>
  );
}
