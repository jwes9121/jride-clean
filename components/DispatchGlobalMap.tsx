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
};

type DriverLocation = {
  driver_id: string;
  lat: number | null;
  lng: number | null;
  status: string;
};

type Props = {
  activeBookings: Booking[];
  drivers: DriverLocation[];
  selectedBookingId: string | null;
};

mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

export function DispatchGlobalMap({
  activeBookings,
  drivers,
  selectedBookingId,
}: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const center: [number, number] = [121.1100, 16.8219];

    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center,
      zoom: 13,
    });

    mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current && mapRef.current.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers whenever drivers / active bookings / selected change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();

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

    // Booking markers
    activeBookings.forEach((b) => {
      if (b.pickup_lat == null || b.pickup_lng == null) return;

      const isSelected = b.id === selectedBookingId;

      const el = document.createElement("div");
      el.className =
        "rounded-full w-3 h-3 border border-white shadow " +
        (isSelected ? "bg-red-500" : "bg-yellow-500");

      const label = b.booking_code ?? b.id;

      const marker = new mapboxgl.Marker(el)
        .setLngLat([b.pickup_lng as number, b.pickup_lat as number])
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setText(
            `Booking: ${label} (${b.status})`
          )
        )
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend([b.pickup_lng as number, b.pickup_lat as number]);
    });

    // Auto-fit bounds if we have at least one point
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
    }
  }, [drivers, activeBookings, selectedBookingId]);

  return (
    <div className="w-full h-full rounded-lg overflow-hidden border bg-gray-100">
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}
