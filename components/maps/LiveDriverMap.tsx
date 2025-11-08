"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
  "";

if (typeof window !== "undefined") {
  // Set once on client
  (mapboxgl as any).accessToken = MAPBOX_TOKEN;
}

type DriverLocation = {
  driverId: string;
  lat: number;
  lng: number;
  status: string;
  color: string;
  expired: boolean;
  updatedAt: string;
};

type LiveDriverMapProps = {
  initialCenter?: [number, number]; // [lng, lat]
  initialZoom?: number;
};

export default function LiveDriverMap({
  initialCenter = [121.10, 16.82],
  initialZoom = 13,
}: LiveDriverMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const [loaded, setLoaded] = useState(false);
  const [tokenMissing, setTokenMissing] = useState(!MAPBOX_TOKEN);

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    if (!MAPBOX_TOKEN) {
      console.error(
        "[LiveDriverMap] Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN (or NEXT_PUBLIC_MAPBOX_TOKEN)."
      );
      setTokenMissing(true);
      return;
    }

    setTokenMissing(false);

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: initialCenter,
      zoom: initialZoom,
    });

    mapRef.current = map;

    map.on("load", () => {
      setLoaded(true);
    });

    return () => {
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
    };
  }, [initialCenter, initialZoom]);

  // Poll live locations
  useEffect(() => {
    if (!loaded || tokenMissing) return;

    let isCancelled = false;

    async function fetchDrivers() {
      try {
        const res = await fetch("/api/driver_locations", {
          method: "GET",
          cache: "no-store",
        });

        if (!res.ok) return;

        const json = await res.json();
        const drivers: DriverLocation[] = json.drivers || [];

        if (!isCancelled && mapRef.current) {
          updateMarkers(drivers);
        }
      } catch (err) {
        console.error("Failed to fetch driver locations", err);
      }
    }

    fetchDrivers();
    const interval = setInterval(fetchDrivers, 5000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [loaded, tokenMissing]);

  function updateMarkers(drivers: DriverLocation[]) {
    const map = mapRef.current;
    if (!map) return;

    const existing = markersRef.current;
    const seen: Record<string, boolean> = {};

    drivers.forEach((driver) => {
      const id = driver.driverId;
      seen[id] = true;

      if (driver.expired) {
        // Hide expired drivers (Option A)
        if (existing[id]) {
          existing[id].remove();
          delete existing[id];
        }
        // Option B: show grey/transparent pins instead (uncomment to use)
        // addOrUpdateMarker(map, existing, driver, "#9ca3af", 0.4);
        return;
      }

      addOrUpdateMarker(map, existing, driver, driver.color, 1);
    });

    // Remove markers for drivers no longer in response
    Object.keys(existing).forEach((id) => {
      if (!seen[id]) {
        existing[id].remove();
        delete existing[id];
      }
    });
  }

  function addOrUpdateMarker(
    map: mapboxgl.Map,
    existing: Record<string, mapboxgl.Marker>,
    driver: DriverLocation,
    color: string,
    opacity: number
  ) {
    const el = document.createElement("div");
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.borderRadius = "999px";
    el.style.backgroundColor = color;
    el.style.border = "2px solid white";
    el.style.boxShadow = "0 0 6px rgba(0,0,0,0.4)";
    el.style.opacity = String(opacity);
    el.title = `${driver.driverId} (${driver.status})`;

    const popup = new mapboxgl.Popup({ closeButton: false }).setText(
      `${driver.driverId} • ${driver.status}`
    );

    if (existing[driver.driverId]) {
      existing[driver.driverId]
        .setLngLat([driver.lng, driver.lat])
        .setPopup(popup);

      const markerEl = existing[driver.driverId].getElement();
      markerEl.style.backgroundColor = color;
      markerEl.style.opacity = String(opacity);
      return;
    }

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([driver.lng, driver.lat])
      .setPopup(popup)
      .addTo(map);

    existing[driver.driverId] = marker;
  }

  return (
    <div className="w-full h-full">
      <div
        ref={mapContainerRef}
        className="w-full h-[600px] rounded-2xl overflow-hidden bg-gray-100"
      >
        {tokenMissing && (
          <div className="w-full h-full flex items-center justify-center text-center text-sm text-red-600">
            Missing <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> in
            <code>.env.local</code>. Add your Mapbox public token and restart
            dev server.
          </div>
        )}
      </div>
      <div className="mt-2 text-xs text-gray-500">
        ● Green: Online & ready &nbsp;|&nbsp; ● Blue: On trip &nbsp;|&nbsp; ● Yellow:
        Idle &nbsp;|&nbsp; Grey: Expired/Offline (hidden if using default)
      </div>
    </div>
  );
}
