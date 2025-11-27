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
  // still passed in from page.component.tsx but unused
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

// How long the "trip" animation should take in milliseconds
const TRIP_DURATION_MS = 60_000; // 60 seconds

export default function BookingMapClient({
  bookingId,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const hasPickup =
      typeof pickupLat === "number" && typeof pickupLng === "number";
    const hasDropoff =
      typeof dropoffLat === "number" && typeof dropoffLng === "number";

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

    // Initial marker at pickup or default
    const marker = new mapboxgl.Marker({ color: "#ff0000" })
      .setLngLat(center)
      .addTo(map);

    markerRef.current = marker;

    // If we don't have both points, just keep the marker static
    if (!hasPickup || !hasDropoff) {
      return () => {
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      };
    }

    // Animate from pickup -> dropoff in a straight line
    const start: [number, number] = [pickupLng as number, pickupLat as number];
    const end: [number, number] = [dropoffLng as number, dropoffLat as number];

    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const tRaw = elapsed / TRIP_DURATION_MS;
      const t = Math.min(Math.max(tRaw, 0), 1); // clamp 0..1

      const lng = start[0] + (end[0] - start[0]) * t;
      const lat = start[1] + (end[1] - start[1]) * t;

      marker.setLngLat([lng, lat]);

      map.easeTo({
        center: [lng, lat],
        zoom: 14,
        duration: 500,
        essential: true,
      });

      if (t < 1 && mapRef.current) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, bookingId]);

  return <div ref={containerRef} className="w-full h-full" />;
}
