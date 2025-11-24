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

export default function BookingMapClient({
  bookingId,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dropoffMarkerRef = useRef<mapboxgl.Marker | null>(null);

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
      };
    } catch (err) {
      console.error("[BookingMapClient] init error:", err);
    }
  }, [pickupLat, pickupLng]);

  // 2) UPDATE MARKERS + CAMERA WHEN COORDS CHANGE
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
