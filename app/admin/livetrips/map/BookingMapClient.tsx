"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { createClient } from "@supabase/supabase-js";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// Supabase browser client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Props = {
  bookingId: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  // still passed in, but unused for now
  driverId?: string | null;
};

type Coords = {
  lat: number;
  lng: number;
};

// TEMP: follow this driver from live_locations for realtime test
const TEST_DRIVER_CODE = "JRIDE-PROD-001";

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
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // ───────────────────── INIT MAP ─────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const center: [number, number] =
      pickupLat != null && pickupLng != null
        ? [pickupLng, pickupLat]
        : [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat];

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center,
      zoom: DEFAULT_ZOOM,
    });

    mapRef.current = map;

    driverMarkerRef.current = new mapboxgl.Marker({
      color: "#ff0000",
    })
      .setLngLat(center)
      .addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      driverMarkerRef.current = null;
    };
  }, [pickupLat, pickupLng]);

  // ───────────────────── HELPER ─────────────────────
  const updateDriverMarker = (lat: number, lng: number) => {
    if (!mapRef.current || !driverMarkerRef.current) return;

    driverMarkerRef.current.setLngLat([lng, lat]);

    mapRef.current.flyTo({
      center: [lng, lat],
      zoom: 14,
      speed: 0.9,
      curve: 1.2,
      essential: true,
    });
  };

  // ───────────────────── INITIAL POSITION FROM live_locations ─────────────────────
  useEffect(() => {
    const fetchInitialLocation = async () => {
      const { data, error } = await supabase
        .from("live_locations")
        .select("*")
        .eq("driver_id", TEST_DRIVER_CODE)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching initial live location:", error);
        return;
      }

      if (!data) return;

      const row: any = data;
      const lat: number | undefined = row.latitude ?? row.lat;
      const lng: number | undefined = row.longitude ?? row.lng;

      if (typeof lat === "number" && typeof lng === "number") {
        updateDriverMarker(lat, lng);
      }
    };

    fetchInitialLocation();
  }, []);

  // ───────────────────── REALTIME SUBSCRIPTION TO live_locations ─────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("live-driver-tracking")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_locations",
        },
        (payload) => {
          const row: any = payload.new;
          if (row.driver_id !== TEST_DRIVER_CODE) return;

          const lat: number | undefined = row.latitude ?? row.lat;
          const lng: number | undefined = row.longitude ?? row.lng;

          if (typeof lat !== "number" || typeof lng !== "number") {
            console.warn("Live location insert without lat/lng", row);
            return;
          }

          updateDriverMarker(lat, lng);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "live_locations",
        },
        (payload) => {
          const row: any = payload.new;
          if (row.driver_id !== TEST_DRIVER_CODE) return;

          const lat: number | undefined = row.latitude ?? row.lat;
          const lng: number | undefined = row.longitude ?? row.lng;

          if (typeof lat !== "number" || typeof lng !== "number") {
            console.warn("Live location update without lat/lng", row);
            return;
          }

          updateDriverMarker(lat, lng);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
