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

    // Always create a NEW map instance each time we open the modal.
    // This avoids the "blank map in modal" issue.
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

    // Pickup marker
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

    // Driver markers
    drivers.forEach((d) => {
      if (d.lat == null || d.lng == null) return;

      const el = document.createElement("div");
      el.className =
        "rounded-full w-3 h-3 border border-white shadow " +
        (d.status === "online"
          ? "bg-green-500"
          : d.status === "on_trip" || d.status === "in_transit"
          ? "bg-blue-500"
          : "bg-gray-400");

      const marker = new mapboxgl.Marker(el)
        .setLngLat([d.lng, d.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setText(
            `Driver: ${d.driver_id} (${d.status})`
          )
        )
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend([d.lng, d.lat]);
    });

    // Fit bounds if we have at least one point
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
    }

    // Extra safety: force resize after a short delay in case modal transition affects size
    setTimeout(() => {
      map.resize();
    }, 200);

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
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
            <div
              ref={mapContainerRef}
              className="w-full h-[400px]"
            />
          )}
        </div>
      </div>
    </div>
  );
}
