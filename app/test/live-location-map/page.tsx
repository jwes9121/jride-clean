"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { supabaseBrowser } from "@/lib/supabaseClient";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

type LiveLocation = {
  id: string;
  driver_id: string;
  lat: number;
  lng: number;
  status: string | null;
  updated_at: string;
};

export default function LiveLocationMapPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  // 1) Init map once
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapboxgl.accessToken) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
      return;
    }

    if (!mapRef.current) {
      mapRef.current = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center: [121.1055, 16.825], // default center (near your test coords)
        zoom: 14,
      });

      mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Helper to place / move marker
  const updateMarker = (lng: number, lat: number) => {
    if (!mapRef.current) return;

    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ color: "#FF0000" })
        .setLngLat([lng, lat])
        .addTo(mapRef.current);
    } else {
      markerRef.current.setLngLat([lng, lat]);
    }

    // Smooth fly to the new position
    mapRef.current.flyTo({ center: [lng, lat], zoom: 14, essential: true });
  };

  // 2) Load latest location on first load
  useEffect(() => {
    const loadInitial = async () => {
      const { data, error } = await supabaseBrowser
        .from("live_locations")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .returns<LiveLocation[]>();

      if (error) {
        console.error("Error fetching initial live location:", error);
        return;
      }

      if (data && data.length > 0) {
        const loc = data[0];
        updateMarker(loc.lng, loc.lat);
      }
    };

    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3) Realtime subscription for live_locations
  useEffect(() => {
    const channel = supabaseBrowser
      .channel("realtime:live_locations")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_locations",
        },
        (payload) => {
          const row = (payload.new || payload.old) as Partial<LiveLocation>;
          if (!row || row.lat == null || row.lng == null) return;

          console.log("Realtime update:", row);
          updateMarker(row.lng, row.lat);
        }
      )
      .subscribe((status) => {
        console.log("Supabase realtime status:", status);
      });

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full h-screen flex flex-col">
      <div className="p-3 text-sm bg-gray-900 text-white">
        <div className="font-semibold">JRide • Live Location Test Map</div>
        <div>Watching table: public.live_locations (Supabase Realtime)</div>
        <div>Driver: JRIDE-PROD-001</div>
      </div>
      <div ref={mapContainerRef} className="flex-1" />
    </div>
  );
}
