jride admin

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
  lng: 121.1,
  lat: 16.8,
  zoom: 11,
};

export default function LiveDriversAdminPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [filteredDrivers, setFilteredDrivers] = useState<DriverLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "on_trip">(
    "all"
  );
  const [townFilter, setTownFilter] = useState<string>("all");
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

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
        setError("Failed to load driver locations from server.");
        return;
      }

      const data: ApiResponse = await res.json();

      if (!("ok" in data) || !data.ok) {
        console.error("API error:", data);
        setError("Failed to load driver locations from API.");
        return;
      }

      const list = data.drivers || [];
      setDrivers(list);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Network error:", err);
      setError("Network error while loading driver locations.");
    } finally {
      setLoading(false);
    }
  };

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

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

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fetch + poll
  useEffect(() => {
    fetchDrivers();
    const interval = setInterval(fetchDrivers, 10000);
    return () => clearInterval(interval);
  }, []);

  // Apply filters
  useEffect(() => {
    let list = [...drivers];

    if (statusFilter !== "all") {
      const target = statusFilter === "on_trip" ? "on_trip" : "online";
      list = list.filter(
        (d) => (d.status || "").toLowerCase() === target
      );
    }

    if (townFilter !== "all") {
      list = list.filter(
        (d) =>
          (d.town || "").toLowerCase() === townFilter.toLowerCase()
      );
    }

    setFilteredDrivers(list);
  }, [drivers, statusFilter, townFilter]);

  // Update markers on filtered list change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existingMarkers = markersRef.current;
    const liveIds = new Set<string>();

    for (const driver of filteredDrivers) {
      const id = driver.driver_id;
      liveIds.add(id);

      const lngLat: [number, number] = [driver.lng, driver.lat];
      const markerColor = getMarkerColor(driver);
      const ageText = formatRelativeTime(driver.updated_at);

      if (existingMarkers[id]) {
        existingMarkers[id]
          .setLngLat(lngLat)
          .getElement().style.backgroundColor = markerColor;
      } else {
        const el = document.createElement("div");
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "9999px";
        el.style.backgroundColor = markerColor;
        el.style.border = "2px solid #ffffff";
        el.style.boxShadow = "0 0 4px rgba(0,0,0,0.5)";
        el.style.cursor = "pointer";

        el.addEventListener("click", () => {
          setSelectedDriverId(id);
          map.flyTo({ center: lngLat, zoom: 14 });
        });

        const popupHtml = `
          <div style="font-size:11px">
            <div><strong>Driver:</strong> ${shortId(id)}</div>
            ${
              driver.town
                ? `<div><strong>Town:</strong> ${driver.town}</div>`
                : ""
            }
            <div><strong>Status:</strong> ${formatStatus(driver.status)}</div>
            <div><strong>Last update:</strong> ${formatTime(
              driver.updated_at
            )} (${ageText})</div>
          </div>
        `;

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(lngLat)
          .setPopup(
            new mapboxgl.Popup({ closeButton: false }).setHTML(popupHtml)
          )
          .addTo(map);

        existingMarkers[id] = marker;
      }
    }

    // Remove markers that are no longer in filtered list
    Object.keys(existingMarkers).forEach((id) => {
      if (!liveIds.has(id)) {
        existingMarkers[id].remove();
        delete existingMarkers[id];
      }
    });
  }, [filteredDrivers]);

  const uniqueTowns = Array.from(
    new Set(
      drivers
        .map((d) => (d.town || "").trim())
        .filter((t) => t.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  const selectedDriver = filteredDrivers.find(
    (d) => d.driver_id === selectedDriverId
  );

  const handleFocusDriver = (driver: DriverLocation) => {
    setSelectedDriverId(driver.driver_id);
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [driver.lng, driver.lat],
      zoom: 14,
      essential: true,
    });
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100">
      <header className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            JRide – Live Drivers (Admin)
          </h1>
          <p className="text-xs text-slate-400">
            Real-time view of active driver locations from production Supabase.
          </p>
        </div>
        <div className="flex flex-col items-end text-[10px] text-slate-400">
          <span>
            Visible drivers:{" "}
            <span className="font-semibold text-slate-100">
              {filteredDrivers.length}
            </span>{" "}
            / {drivers.length}
          </span>
          <span>
            Updated:{" "}
            {lastUpdated ? lastUpdated : loading ? "Loading…" : "—"}
          </span>
          <button
            onClick={fetchDrivers}
            className="mt-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[9px]"
          >
            Refresh now
          </button>
        </div>
      </header>

      {error && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-950/40 border-b border-red-900">
          {error}
        </div>
      )}

      <main className="flex flex-1">
        {/* Map */}
        <div className="flex-1 relative">
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
        </div>

        {/* Side panel */}
        <aside className="w-72 border-l border-slate-800 bg-slate-950/95 flex flex-col">
          <div className="px-3 py-2 border-b border-slate-800 flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <label className="flex-1">
                <span className="block text-[9px] text-slate-500">
                  Status
                </span>
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as any)
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px]"
                >
                  <option value="all">All</option>
                  <option value="online">Online</option>
                  <option value="on_trip">On Trip</option>
                </select>
              </label>

              <label className="flex-1">
                <span className="block text-[9px] text-slate-500">
                  Town
                </span>
                <select
                  value={townFilter}
                  onChange={(e) =>
                    setTownFilter(e.target.value)
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px]"
                >
                  <option value="all">All</option>
                  {uniqueTowns.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredDrivers.length === 0 ? (
              <div className="px-3 py-3 text-[10px] text-slate-500">
                No drivers match the current filters.
              </div>
            ) : (
              filteredDrivers.map((d) => {
                const age = formatRelativeTime(d.updated_at);
                const statusLabel = formatStatus(d.status);
                const color = getMarkerColor(d);

                return (
                  <button
                    key={d.driver_id}
                    onClick={() => handleFocusDriver(d)}
                    className={`w-full text-left px-3 py-2 border-b border-slate-900 text-[10px] hover:bg-slate-900/70 flex flex-col gap-[2px] ${
                      selectedDriverId === d.driver_id
                        ? "bg-slate-900"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-semibold text-slate-100">
                          {shortId(d.driver_id)}
                        </span>
                      </div>
                      <span className="text-[9px] text-slate-400">
                        {d.town || "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px]">
                        {statusLabel}
                      </span>
                      <span className="text-[8px] text-slate-500">
                        {age}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {selectedDriver && (
            <div className="px-3 py-2 border-t border-slate-800 text-[9px] bg-slate-950">
              <div className="font-semibold text-slate-100 mb-1">
                Selected Driver
              </div>
              <div>Id: {shortId(selectedDriver.driver_id)}</div>
              <div>Town: {selectedDriver.town || "Unknown"}</div>
              <div>Status: {formatStatus(selectedDriver.status)}</div>
              <div>
                Last update: {formatTime(selectedDriver.updated_at)} (
                {formatRelativeTime(selectedDriver.updated_at)})
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

/* Helpers */

function getMarkerColor(driver: DriverLocation): string {
  const status = (driver.status || "").toLowerCase();
  const ageMs = Date.now() - new Date(driver.updated_at).getTime();

  // Stale > 2 minutes
  if (ageMs > 2 * 60 * 1000) return "#6b7280"; // gray

  if (status === "on_trip" || status === "ontrip") return "#22c55e"; // green
  if (status === "online") return "#38bdf8"; // blue
  if (status === "offline") return "#6b7280"; // gray

  const town = (driver.town || "").toLowerCase();
  if (town.includes("lagawe")) return "#f97316";
  if (town.includes("kiangan")) return "#22c55e";
  if (town.includes("banaue")) return "#3b82f6";
  if (town.includes("lamut")) return "#a855f7";

  return "#facc15";
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

function formatStatus(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "on_trip" || s === "ontrip") return "On Trip";
  if (s === "online") return "Online";
  if (s === "offline") return "Offline";
  return status || "Unknown";
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Date.now() - d;

  const sec = Math.round(diff / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;

  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
