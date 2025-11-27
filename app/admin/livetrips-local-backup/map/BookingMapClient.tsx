"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

type Props = {
  bookingId: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  driverId?: string | null;
};

type DriverLocationRow = {
  driver_id: string;
  lat: number;
  lng: number;
  status?: string | null;
  is_on_trip?: boolean | null;
};

const DEFAULT_CENTER = { lat: 16.81, lng: 121.11 };
const DEFAULT_ZOOM = 12;

let browserSupabase: SupabaseClient | null = null;
function getSupabaseClient(): SupabaseClient | null {
  if (browserSupabase) return browserSupabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  browserSupabase = createClient(url, anon);
  return browserSupabase;
}

export default function BookingMapClient({
  bookingId,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  driverId,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const [debug, setDebug] = useState("initialising");
  const [mapReady, setMapReady] = useState(false);

  // Map init
  useEffect(() => {
    if (!containerRef.current || !mapboxgl.accessToken) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
    });

    mapRef.current = map;

    map.on("load", () => {
      setMapReady(true);
      setDebug("map loaded");
      map.resize();
    });

    return () => {
      map.remove();
    };
  }, []);

  // Pickup + dropoff markers
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!bookingId || pickupLat == null || pickupLng == null) {
      setDebug("map loaded — waiting for booking");
      return;
    }

    const pickup: [number, number] = [pickupLng, pickupLat];
    const dropoff =
      dropoffLat != null && dropoffLng != null
        ? [dropoffLng, dropoffLat]
        : null;

    map.jumpTo({ center: pickup, zoom: DEFAULT_ZOOM });

    (map as any)._jrideMarkers?.forEach((m: mapboxgl.Marker) => m.remove());
    const markers: mapboxgl.Marker[] = [];

    markers.push(new mapboxgl.Marker({ color: "#10b981" }).setLngLat(pickup).addTo(map));

    if (dropoff) {
      markers.push(new mapboxgl.Marker({ color: "#ef4444" }).setLngLat(dropoff).addTo(map));
    }

    (map as any)._jrideMarkers = markers;

    setDebug(`Booking ${bookingId} loaded`);
  }, [bookingId, pickupLat, pickupLng, dropoffLat, dropoffLng, mapReady]);

  return (
    <div
      className="relative w-full rounded-lg border border-gray-200 overflow-hidden"
      style={{ height: 600, backgroundColor: "#e5e7eb" }}
    >
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute left-2 top-2 z-10 bg-white/80 px-3 py-1 text-xs shadow">
        {`MAP DEBUG: ${debug}`}
      </div>
    </div>
  );
}
