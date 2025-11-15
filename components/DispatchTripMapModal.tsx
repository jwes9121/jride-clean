"use client";

// @ts-ignore
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { useEffect, useRef } from "react";

type Booking = {
  id: string;
  booking_code: string | null;
  status: string;
  assigned_driver_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  created_at: string;
};

type DriverLocation = {
  driver_id: string;
  lat: number | null;
  lng: number | null;
  status: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  booking: Booking | null;
  drivers: DriverLocation[];
};

mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

const ROUTE_SOURCE_ID = "trip-route-source";
const ROUTE_LAYER_ID = "trip-route-layer";

export function DispatchTripMapModal({
  open,
  onClose,
  booking,
  drivers,
}: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    // If modal is closed or no booking, destroy map and exit
    if (!open || !booking) {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }

    const container = mapContainerRef.current;
    if (!container) return;

    // Determine initial center (pickup or default Lagawe-ish coords)
    const center: [number, number] = [
      booking.pickup_lng ?? 121.1100,
      booking.pickup_lat ?? 16.8219,
    ];

    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/streets-v11",
      center,
      zoom: 13,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    mapRef.current = map;

    const bounds = new mapboxgl.LngLatBounds();

    // --- PICKUP MARKER ---
    if (booking.pickup_lat != null && booking.pickup_lng != null) {
      const el = document.createElement("div");
      el.className =
        "rounded-full w-4 h-4 border-2 border-white shadow bg-red-500";

      const label = booking.booking_code ?? booking.id;

      const pickupMarker = new mapboxgl.Marker(el)
        .setLngLat([booking.pickup_lng as number, booking.pickup_lat as number])
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setText(
            `Pickup for ${label} (${booking.status})`
          )
        )
        .addTo(map);

      markersRef.current.push(pickupMarker);
      bounds.extend([
        booking.pickup_lng as number,
        booking.pickup_lat as number,
      ]);
    }

    // --- DRIVER MARKERS ---
    const assignedDriver = booking.assigned_driver_id
      ? drivers.find((d) => d.driver_id === booking.assigned_driver_id)
      : null;

    drivers.forEach((d) => {
      if (d.lat == null || d.lng == null) return;

      const isAssigned =
        assignedDriver && d.driver_id === assignedDriver.driver_id;

      const el = document.createElement("div");
      el.className =
        "rounded-full border border-white shadow " +
        (isAssigned
          ? "w-4 h-4 bg-blue-500"
          : "w-3 h-3 " +
            (d.status === "online"
              ? "bg-green-500"
              : d.status === "on_trip" || d.status === "in_transit"
              ? "bg-blue-500"
              : "bg-gray-400"));

      const marker = new mapboxgl.Marker(el)
        .setLngLat([d.lng, d.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setText(
            `Driver: ${d.driver_id} (${d.status}${
              isAssigned ? ", ASSIGNED" : ""
            })`
          )
        )
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend([d.lng, d.lat]);
    });

    // --- ROUTE: assigned driver → pickup (if both exist) ---
    map.on("load", async () => {
      try {
        if (
          !assignedDriver ||
          assignedDriver.lat == null ||
          assignedDriver.lng == null ||
          booking.pickup_lat == null ||
          booking.pickup_lng == null
        ) {
          // No route possible
        } else {
          const fromLng = assignedDriver.lng;
          const fromLat = assignedDriver.lat;
          const toLng = booking.pickup_lng;
          const toLat = booking.pickup_lat;

          const coords = `${fromLng},${fromLat};${toLng},${toLat}`;
          const token = mapboxgl.accessToken;

          const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${token}`;

          const res = await fetch(url);
          if (res.ok) {
            const json = await res.json();
            const route =
              json?.routes && json.routes[0]?.geometry
                ? json.routes[0].geometry
                : null;

            if (route) {
              if (map.getLayer(ROUTE_LAYER_ID)) {
                map.removeLayer(ROUTE_LAYER_ID);
              }
              if (map.getSource(ROUTE_SOURCE_ID)) {
                map.removeSource(ROUTE_SOURCE_ID);
              }

              map.addSource(ROUTE_SOURCE_ID, {
                type: "geojson",
                data: {
                  type: "Feature",
                  properties: {},
                  geometry: route,
                },
              });

              map.addLayer({
                id: ROUTE_LAYER_ID,
                type: "line",
                source: ROUTE_SOURCE_ID,
                layout: {
                  "line-join": "round",
                  "line-cap": "round",
                },
                paint: {
                  "line-width": 4,
                  "line-color": "#2563eb", // Tailwind blue-600
                  "line-opacity": 0.8,
                },
              });

              // Extend bounds with route geometry
              if (route.coordinates && Array.isArray(route.coordinates)) {
                route.coordinates.forEach((c: [number, number]) => {
                  bounds.extend(c);
                });
              }
            }
          }
        }

        // Fit bounds AFTER markers + route
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
        }

        // Force resize to avoid blank issues
        setTimeout(() => {
          map.resize();
        }, 200);
      } catch (err) {
        console.error("[DispatchTripMapModal] Error loading route:", err);
      }
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (map.getLayer(ROUTE_LAYER_ID)) {
        map.removeLayer(ROUTE_LAYER_ID);
      }
      if (map.getSource(ROUTE_SOURCE_ID)) {
        map.removeSource(ROUTE_SOURCE_ID);
      }
      map.remove();
      mapRef.current = null;
    };
  }, [open, booking, drivers]);

  if (!open || !booking) return null;

  const label = booking.booking_code ?? booking.id;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <header className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">
              Trip Map – {label}
            </h2>
            <p className="text-xs text-gray-600">
              Status: {booking.status} · Created at{" "}
              {new Date(booking.created_at).toLocaleString()}
            </p>
            {booking.assigned_driver_id && (
              <p className="text-[11px] text-gray-500">
                Assigned driver: {booking.assigned_driver_id} (blue marker)
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1 rounded-md border hover:bg-gray-50"
          >
            Close
          </button>
        </header>

        <div className="flex-1">
          {booking.pickup_lat == null || booking.pickup_lng == null ? (
            <div className="h-[400px] flex items-center justify-center text-xs text-gray-500">
              No pickup coordinates available for this booking.
            </div>
          ) : (
            <div ref={mapContainerRef} className="w-full h-[400px]" />
          )}
        </div>
      </div>
    </div>
  );
}
