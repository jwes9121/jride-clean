"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Props = {
  bookingId: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  // still passed but unused for now
  driverId?: string | null;
};

type Coords = {
  lat: number;
  lng: number;
};

const DEFAULT_CENTER: Coords = {
  lat: 16.81,
  lng: 121.11,
};

const DEFAULT_ZOOM = 12;

export default function BookingMapClient({
  bookingId,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Destroy previous map instance if re-rendered for another booking
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const hasPickup =
      typeof pickupLat === "number" && typeof pickupLng === "number";

    const center: [number, number] = hasPickup
      ? [pickupLng as number, pickupLat as number]
      : [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat];

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center,
      zoom: DEFAULT_ZOOM,
    });

    mapRef.current = map;

    // Put a marker at pickup if we have it
    if (hasPickup) {
      new mapboxgl.Marker({ color: "#ff0000" })
        .setLngLat(center)
        .addTo(map);
    }

    // (Optional) In the future we can draw route from pickup → dropoff here

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [bookingId, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  return <div ref={containerRef} className="w-full h-full" />;
}
