"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Props = {
  bookingId: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  // assigned driver for this booking (uuid from bookings.assigned_driver_id)
  driverId: string | null;
};

type Coords = {
  lat: number;
  lng: number;
};

const DEFAULT_CENTER: Coords = {
  lat: 16.81,
  lng: 121.11,
};

const DEFAULT_ZOOM = 11;

function hasCoords(lat: number | null, lng: number | null): boolean {
  return typeof lat === "number" && typeof lng === "number";
}

type DriverLocationRow = {
  lat: number | null;
  lng: number | null;
};

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
  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dropoffMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // Supabase client (re-used across effects)
  const supabaseRef =
    useRef<ReturnType<typeof createClientComponentClient> | null>(null);
  if (!supabaseRef.current) {
    supabaseRef.current = createClientComponentClient();
  }
  const supabase = supabaseRef.current;

  // Helper: update or create the driver marker, and optionally fly camera
  const updateDriverMarker = (
    lat: number,
    lng: number,
    flyToDriver: boolean = true
  ) => {
    const map = mapRef.current;
    if (!map) return;

    const lngLat: [number, number] = [lng, lat];

    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new mapboxgl.Marker({ color: "#007aff" }) // blue driver marker
        .setLngLat(lngLat)
        .addTo(map);
    } else {
      driverMarkerRef.current.setLngLat(lngLat);
    }

    if (flyToDriver) {
      map.flyTo({
        center: lngLat,
        zoom: 15,
        speed: 1.4,
      });
    }
  };

  // 1) INIT MAP ONCE
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    try {
      const center: [number, number] = [
        typeof pickupLng === "number" ? pickupLng : DEFAULT_CENTER.lng,
        typeof pickupLat === "number" ? pickupLat : DEFAULT_CENTER.lat,
      ];

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center,
        zoom: DEFAULT_ZOOM,
      });

      mapRef.current = map;

      map.on("error", (e: any) => {
        console.error("[BookingMapClient] map error:", e);
      });

      return () => {
        try {
          map.remove();
        } catch (err) {
          console.error("[BookingMapClient] cleanup error:", err);
        }
        mapRef.current = null;
        pickupMarkerRef.current = null;
        dropoffMarkerRef.current = null;
        driverMarkerRef.current = null;
      };
    } catch (err) {
      console.error("[BookingMapClient] init error:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) UPDATE PICKUP + DROPOFF MARKERS + CAMERA WHEN COORDS CHANGE
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    try {
      // PICKUP
      if (hasCoords(pickupLat, pickupLng)) {
        const pickupLL: [number, number] = [
          pickupLng as number,
          pickupLat as number,
        ];
        if (!pickupMarkerRef.current) {
          pickupMarkerRef.current = new mapboxgl.Marker({ color: "#1DB954" })
            .setLngLat(pickupLL)
            .addTo(map);
        } else {
          pickupMarkerRef.current.setLngLat(pickupLL);
        }
      }

      // DROPOFF
      if (hasCoords(dropoffLat, dropoffLng)) {
        const dropoffLL: [number, number] = [
          dropoffLng as number,
          dropoffLat as number,
        ];
        if (!dropoffMarkerRef.current) {
          dropoffMarkerRef.current = new mapboxgl.Marker({ color: "#FF5733" })
            .setLngLat(dropoffLL)
            .addTo(map);
        } else {
          dropoffMarkerRef.current.setLngLat(dropoffLL);
        }
      }

      const hasPickup = hasCoords(pickupLat, pickupLng);
      const hasDropoff = hasCoords(dropoffLat, dropoffLng);

      if (hasPickup && hasDropoff) {
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([pickupLng as number, pickupLat as number]);
        bounds.extend([dropoffLng as number, dropoffLat as number]);

        map.fitBounds(bounds, {
          padding: 80,
          maxZoom: 15,
          duration: 900,
        });
      } else if (hasPickup) {
        map.flyTo({
          center: [pickupLng as number, pickupLat as number],
          zoom: 15,
          speed: 1.4,
        });
      } else if (hasDropoff) {
        map.flyTo({
          center: [dropoffLng as number, dropoffLat as number],
          zoom: 15,
          speed: 1.4,
        });
      } else {
        map.flyTo({
          center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
          zoom: DEFAULT_ZOOM,
          speed: 1.2,
        });
      }
    } catch (err) {
      console.error("[BookingMapClient] update error:", err);
    }
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

  // 3) REALTIME DRIVER MARKER (driver_locations table)
  useEffect(() => {
    if (!driverId) return;
    if (!supabase) return;

    let cancelled = false;

    const map = mapRef.current;
    if (!map) return;

    // Initial position fetch
    (async () => {
      try {
        const { data, error } = await supabase
          .from("driver_locations")
          .select("lat,lng")
          .eq("driver_id", driverId)
          .maybeSingle();

        const row = data as DriverLocationRow | null;

        if (
          !cancelled &&
          !error &&
          row &&
          typeof row.lat === "number" &&
          typeof row.lng === "number"
        ) {
          updateDriverMarker(row.lat, row.lng, false);
        }
      } catch (err) {
        console.error("[BookingMapClient] initial driver fetch error:", err);
      }
    })();

    // Realtime subscription
    const channel = supabase
      .channel(`driver-location-${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_locations",
          filter: `driver_id=eq.${driverId}`,
        },
        (payload: any) => {
          const row = (payload.new || payload.old) as DriverLocationRow | null;
          if (!row) return;

          const lat = row.lat;
          const lng = row.lng;

          if (typeof lat === "number" && typeof lng === "number") {
            updateDriverMarker(lat, lng, true);
          }
        }
      )
      .subscribe((status: string) => {
        console.log("[BookingMapClient] driver channel status:", status);
      });

    return () => {
      cancelled = true;
      try {
        supabase.removeChannel(channel);
      } catch (err) {
        console.error("[BookingMapClient] remove channel error:", err);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  return (
    <div className="w-full h-full">
      {bookingId && (
        <div className="mb-2 text-xs text-gray-600">
          Booking ID:{" "}
          <span className="font-mono font-semibold">{bookingId}</span>
        </div>
      )}

      <div
        ref={containerRef}
        className="w-full h-[520px] rounded-lg overflow-hidden border border-gray-200"
      />
    </div>
  );
}
