"use client";

import React, {
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type ActiveTrip = {
  id: string;
  booking_code: string | null;
  passenger_name: string | null;
  from_label: string | null;
  to_label: string | null;
  town: string | null;
  status: string | null;
  assigned_driver_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  updated_at: string | null;
};

type DriverNameMap = Record<string, string>;

function normalizeStatus(status: string | null): string {
  return (status ?? "").toLowerCase();
}

async function fetchDriverNamesForTrips(
  trips: ActiveTrip[]
): Promise<DriverNameMap> {
  const ids = Array.from(
    new Set(
      trips
        .map((t) => t.assigned_driver_id)
        .filter((id): id is string => !!id)
    )
  );

  if (!ids.length) return {};

  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .in("id", ids);

    if (error || !data) {
      console.error("LIVETRIPS_DRIVER_NAMES_ERROR", error);
      return {};
    }

    const map: DriverNameMap = {};
    (data as any[]).forEach((row) => {
      const anyRow: any = row;
      const label =
        anyRow.full_name ??
        anyRow.name ??
        anyRow.driver_name ??
        anyRow.display_name ??
        anyRow.label ??
        (typeof anyRow.id === "string"
          ? anyRow.id.substring(0, 8)
          : String(anyRow.id ?? ""));
      if (anyRow.id && label) {
        map[String(anyRow.id)] = String(label);
      }
    });

    return map;
  } catch (err) {
    console.error("LIVETRIPS_DRIVER_NAMES_UNEXPECTED", err);
    return {};
  }
}

function LiveTripsMap({
  trips,
  focusedBookingId,
}: {
  trips: ActiveTrip[];
  focusedBookingId?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!mapContainerRef.current) return;
    if (!token) return;

    const tripsWithCoords = trips.filter(
      (t) =>
        typeof t.pickup_lat === "number" &&
        typeof t.pickup_lng === "number"
    );
    if (tripsWithCoords.length === 0) {
      return;
    }

    mapboxgl.accessToken = token;

    const primaryTrip =
      (focusedBookingId &&
        tripsWithCoords.find((t) => t.id === focusedBookingId)) ||
      tripsWithCoords[0];

    const center: [number, number] = [
      primaryTrip.pickup_lng as number,
      primaryTrip.pickup_lat as number,
    ];

    if (!mapRef.current) {
      mapRef.current = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center,
        zoom: 13,
      });
    } else {
      mapRef.current.setCenter(center);
    }

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!mapRef.current) return;

    tripsWithCoords.forEach((trip) => {
      const marker = new mapboxgl.Marker()
        .setLngLat([
          trip.pickup_lng as number,
          trip.pickup_lat as number,
        ])
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setText(
            `${trip.booking_code ?? ""} – ${
              trip.passenger_name ?? ""
            }`
          )
        )
        .addTo(mapRef.current as mapboxgl.Map);

      markersRef.current.push(marker);
    });
  }, [trips, focusedBookingId, token]);

  if (!trips.length) return null;

  if (!token) {
    return (
      <div className="mt-4 text-xs text-red-600">
        Mapbox token missing (NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN).
      </div>
    );
  }

  const tripsWithCoords = trips.filter(
    (t) =>
      typeof t.pickup_lat === "number" &&
      typeof t.pickup_lng === "number"
  );
  if (tripsWithCoords.length === 0) {
    return (
      <div className="mt-4 text-xs text-gray-600">
        No pickup coordinates available yet for these trips. The map will show
        markers once bookings have <span className="font-mono">pickup_lat</span>{" "}
        and <span className="font-mono">pickup_lng</span> values.
      </div>
    );
  }

  return (
    <div className="mt-4 h-96 w-full border rounded">
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}

function LiveTripsInner() {
  const searchParams = useSearchParams();
  const focusedBookingId = searchParams.get("bookingId") ?? undefined;

  const [trips, setTrips] = useState<ActiveTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [driverNames, setDriverNames] = useState<DriverNameMap>({});

  const loadTrips = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const qs = focusedBookingId ? `?bookingId=${focusedBookingId}` : "";
      const res = await fetch(`/api/admin/active-trips${qs}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("ACTIVE_TRIPS_API_ERROR", text);
        setErrorMessage("Failed to load active trips.");
        setTrips([]);
        setDriverNames({});
        setLoading(false);
        return;
      }

      const json = await res.json();
      const tripsData = (json.trips as ActiveTrip[]) ?? [];
      setTrips(tripsData);

      const names = await fetchDriverNamesForTrips(tripsData);
      setDriverNames(names);
    } catch (err) {
      console.error("ACTIVE_TRIPS_API_UNEXPECTED", err);
      setErrorMessage("Unexpected error while loading active trips.");
      setTrips([]);
      setDriverNames({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrips();
  }, [focusedBookingId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Live Trips (Dispatch)</h1>
        <button
          onClick={loadTrips}
          disabled={loading}
          className="px-3 py-1 rounded text-sm border bg-blue-600 text-white disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {focusedBookingId && (
        <p className="text-sm text-gray-600">
          Focused booking ID:{" "}
          <span className="font-mono">{focusedBookingId}</span>
        </p>
      )}

      {errorMessage && (
        <div className="p-3 rounded bg-red-100 text-red-800 text-sm border border-red-300">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <p>Loading active trips...</p>
      ) : trips.length === 0 ? (
        <p>No active trips.</p>
      ) : (
        <>
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="bg-gray-200">
                <th className="p-2 border">Code</th>
                <th className="p-2 border">Passenger</th>
                <th className="p-2 border">From</th>
                <th className="p-2 border">To</th>
                <th className="p-2 border">Town</th>
                <th className="p-2 border">Status</th>
                <th className="p-2 border">Driver</th>
                <th className="p-2 border">Updated</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => {
                const normStatus = normalizeStatus(t.status);
                const isFocused = focusedBookingId === t.id;
                let statusClass = "";
                if (normStatus === "on_trip") statusClass = "text-green-700";
                else if (normStatus === "assigned" || normStatus === "accepted")
                  statusClass = "text-blue-700";
                else if (normStatus === "cancelled")
                  statusClass = "text-red-700";

                const driverLabel = t.assigned_driver_id
                  ? driverNames[t.assigned_driver_id] ??
                    t.assigned_driver_id ??
                    "—"
                  : "—";

                return (
                  <tr
                    key={t.id}
                    className={isFocused ? "bg-yellow-50" : ""}
                  >
                    <td className="p-2 border font-mono">
                      {t.booking_code}
                    </td>
                    <td className="p-2 border">{t.passenger_name}</td>
                    <td className="p-2 border">{t.from_label}</td>
                    <td className="p-2 border">{t.to_label}</td>
                    <td className="p-2 border">{t.town}</td>
                    <td
                      className={`p-2 border font-bold uppercase ${statusClass}`}
                    >
                      {t.status}
                    </td>
                    <td className="p-2 border">{driverLabel}</td>
                    <td className="p-2 border">{t.updated_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="text-xs text-gray-500">
            <p>
              This view lists all trips with status{" "}
              <span className="font-mono">
                accepted / assigned / arrived / on_trip
              </span>
              . The row matching the{" "}
              <span className="font-mono">bookingId</span> in the URL is
              highlighted.
            </p>
          </div>

          <LiveTripsMap
            trips={trips}
            focusedBookingId={focusedBookingId}
          />
        </>
      )}
    </div>
  );
}

export default function LiveTripsPage() {
  return (
    <div className="p-6 space-y-4">
      <Suspense fallback={<p>Loading live trips...</p>}>
        <LiveTripsInner />
      </Suspense>
    </div>
  );
}
