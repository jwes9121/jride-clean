"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

type BookingMapProps = {
  pickupLat: number;
  pickupLng: number;
  dropoffLat?: number;
  dropoffLng?: number;
};

export function BookingMap({
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
}: BookingMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    if (!mapboxgl.accessToken) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [pickupLng, pickupLat],
      zoom: 14,
    });

    mapRef.current = map;

    // Pickup marker (green)
    new mapboxgl.Marker({ color: "#22c55e" })
      .setLngLat([pickupLng, pickupLat])
      .setPopup(new mapboxgl.Popup().setText("Pickup"))
      .addTo(map);

    // Dropoff marker (red) if available
    if (
      typeof dropoffLat === "number" &&
      !Number.isNaN(dropoffLat) &&
      typeof dropoffLng === "number" &&
      !Number.isNaN(dropoffLng)
    ) {
      new mapboxgl.Marker({ color: "#ef4444" })
        .setLngLat([dropoffLng, dropoffLat])
        .setPopup(new mapboxgl.Popup().setText("Dropoff"))
        .addTo(map);

      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([pickupLng, pickupLat]);
      bounds.extend([dropoffLng, dropoffLat]);
      map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 0 });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

  return (
    <div className="mt-4 h-[500px] w-full border rounded-lg overflow-hidden">
      <div ref={mapContainerRef} className="h-full w-full" />
    </div>
  );
}
