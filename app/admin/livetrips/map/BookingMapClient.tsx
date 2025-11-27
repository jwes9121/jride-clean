"use client";

import { useEffect, useRef, useState } from "react";
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
  // passed by page.component.tsx but not needed anymore
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
  // we ignore driverId, we compute mapping internally now
  driverId,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // UUID from bookings.assigned_driver_id
  const [driverProfileId, setDriverProfileId] = useState<string | null>(null);
  // Code like "JRIDE-PROD-001" from driver_profiles (used in live_locations.driver_id)
  const [driverCode, setDriverCode] = useState<string | null>(null);

  // ───────────────────── MAP INIT ─────────────────────
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

  // ───────────────────── 1) GET DRIVER PROFILE ID FROM BOOKING ─────────────────────
  useEffect(() => {
    if (!bookingId) return;

    const fetchAssignedDriver = async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("assigned_driver_id")
        .eq("id", bookingId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching assigned driver:", error);
        return;
      }

      if (data?.assigned_driver_id) {
        setDriverProfileId(data.assigned_driver_id as string);
      } else {
        setDriverProfileId(null);
        setDriverCode(null);
      }
    };

    fetchAssignedDriver();
  }, [bookingId]);

  // ───────────────────── 2) MAP PROFILE ID → DRIVER CODE (JRIDE-PROD-001) ─────────────────────
  useEffect(() => {
    if (!driverProfileId) return;

    const fetchDriverCode = async () => {
      const { data, error } = await supabase
        .from("driver_profiles")
        .select("*")
        .eq("id", driverProfileId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching driver profile:", error);
        return;
      }

      if (!data) {
        setDriverCode(null);
        return;
      }

      const row: any = data;

      // Adjust this if your column name is different
      const code: string | undefined =
        row.driver_code ?? row.code ?? row.driver_id;

      if (typeof code === "string") {
        setDriverCode(code);
      } else {
        console.warn("Could not determine driver code from profile row:", row);
        setDriverCode(null);
      }
    };

    fetchDriverCode();
  }, [driverProfileId]);

  // ───────────────────── 3) INITIAL POSITION FROM live_locations ─────────────────────
  useEffect(() => {
    if (!driverCode) return;

    const fetchInitialLocation = async () => {
      const { data, error } = await supabase
        .from("live_locations")
        .select("*")
        .eq("driver_id", driverCode)
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
  }, [driverCode]);

  // ───────────────────── 4) REALTIME SUBSCRIPTION TO live_locations ─────────────────────
  useEffect(() => {
    if (!driverCode) return;

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
          if (row.driver_id !== driverCode) return;

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
          if (row.driver_id !== driverCode) return;

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
  }, [driverCode]);

  return <div ref={containerRef} className="w-full h-full" />;
}
