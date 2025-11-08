"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type DriverLocation = {
  driver_id: string;
  lat: number;
  lng: number;
  status: string;
  town: string | null;
  updated_at: string;
};

type ApiResponse =
  | { ok: true; drivers: DriverLocation[] }
  | { ok: false; error: string };

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

const MAP_INITIAL = {
  // Center roughly over Ifugao / JRide area; adjust as needed
  lng: 121.1,
  lat: 16.8,
  zoom: 11,
};

export default function LiveDriversPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Fetch drivers from the admin API
  const fetchDrivers = async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/driver-locations", {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("Failed to fetch drivers:", text);
        setError("Failed to load driver locations");
        return;
      }

      const data: ApiResponse = await res.json();

      if (!("ok" in data) || !data.ok) {
        console.error("API error:", data);
        setError("Failed to load driver locations");
        return;
      }

      setDrivers(data.drivers || []);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Network error:", err);
      setError("Network error while loading driver locations");
    } finally {
      setLoading(false);
    }
  };

  // Initialize the map once
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return; // already initialized

    if (!mapboxgl.accessToken) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
      setError("Mapbox token is missing. Check environment variables.");
      setLoading(false);
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [MAP_INITIAL.lng, MAP_INITIAL.lat],
      zoom: MAP_INITIAL.zoom,
    });

    mapRef.current = map;

    // Add navigation controls (zoom in/out)
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    return () => {
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Load drivers on mount + set up polling
  useEffect(() => {
    fetchDrivers(); // initial

    const interval = setInterval(() => {
      fetchDrivers();
    }, 10000); // every 10 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers whenever drivers change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existingMarkers = markersRef.current;

    const liveIds = new Set<string>();

    for (const driver of drivers) {
      const id = driver.driver_id;
      liveIds.add(id);

      const lngLat: [number, number] = [driver.lng, driver.lat];

      // Decide marker color by status / town (simple example)
      const markerColor = getMarkerColor(driver);

      if (existingMarkers[id]) {
        // Update existing marker position & color
        existingMarkers[id]
          .setLngLat(lngLat)
          .getElement().style.backgroundColor = markerColor;
      } else {
        // Create new marker
        const el = document.createElement("div");
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "9999px";
        el.style.backgroundColor = markerColor;
        el.style.border = "2px solid #ffffff";
        el.style.boxShadow = "0 0 4px rgba(0,0,0,0.5)";

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(lngLat)
          .setPopup(
            new mapboxgl.Popup({ closeButton: false }).setHTML(
              `
              <div style="font-size:12px">
                <div><strong>Driver:</strong> ${shortId(id)}</div>
                ${
                  driver.town
                    ? `<div><strong>Town:</strong> ${driver.town}</div>`
                    : ""
                }
                <div><strong>Status:</strong> ${driver.status}</div>
                <div><strong>Updated:</strong> ${formatTime(
                  driver.updated_at
                )}</div>
              </div>
            `
            )
          )
          .addTo(map);

        existingMarkers[id] = marker;
      }
    }

    // Remove markers for drivers that are no longer returned
    Object.keys(existingMarkers).forEach((id) => {
      if (!liveIds.has(id)) {
        existingMarkers[id].remove();
        delete existingMarkers[id];
      }
    });
  }, [drivers]);

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100">
      <header className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            JRide – Live Drivers (Admin)
          </h1>
          <p className="text-xs text-slate-400">
            Shows all active drivers from production Supabase (
            <code>driver_locations</code>) via secure admin API.
          </p>
        </div>
        <div className="flex flex-col items-end text-[10px] text-slate-400">
          <span>
            Drivers:{" "}
            <span className="font-semibold text-slate-100">
              {drivers.length}
            </span>
          </span>
          <span>
            Updated:{" "}
            {lastUpdated ? lastUpdated : loading ? "Loading..." : "—"}
          </span>
        </div>
      </header>

      {error && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-950/40 border-b border-red-900">
          {error}
        </div>
      )}

      <main className="flex-1 relative">
        <div
          ref={mapContainerRef}
          className="absolute inset-0"
          style={{ minHeight: "100%", minWidth: "100%" }}
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-4 py-2 text-xs rounded bg-slate-900/80 border border-slate-700 text-slate-200">
              Loading live driver locations…
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Decide marker color based on status/town.
 * Adjust mapping to your actual statuses/towns.
 */
function getMarkerColor(driver: DriverLocation): string {
  const status = (driver.status || "").toLowerCase();
  if (status === "on_trip" || status === "ontrip") return "#22c55e"; // green
  if (status === "online") return "#38bdf8"; // blue
  if (status === "offline") return "#6b7280"; // gray

  // Town-based accent (optional)
  const town = (driver.town || "").toLowerCase();
  if (town.includes("lagawe")) return "#b91c1c"; // maroon/red
  if (town.includes("kiangan")) return "#16a34a"; // green
  if (town.includes("banaue")) return "#7c3aed"; // violet
  if (town.includes("lamut")) return "#f97316"; // orange

  return "#facc15"; // default yellow
}

function shortId(id: string): string {
  if (!id) return "";
  if (id.length <= 8) return id;
  return id.slice(0, 4) + "…" + id.slice(-4);
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}
