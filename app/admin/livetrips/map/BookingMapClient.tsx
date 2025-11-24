"use client";

import React, { useEffect, useRef } from "react";
import mapboxgl, { Map, Marker } from "mapbox-gl";
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

function isValidCoord(lat: number | null, lng: number | null): lat is number {
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
  const mapRef = useRef<Map | null>(null);
  const pickupMarkerRef = useRef<Marker | null>(null);
  const dropoffMarkerRef = useRef<Marker | null>(null);

  // --- 1) INITIALIZE MAP ONCE ---
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return; // already initialized

    const initialCenter: [number, number] = [
      typeof pickupLng === "number" ? pickupLng : DEFAULT_CENTER.lng,
      typeof pickupLat === "number" ? pickupLat : DEFAULT_CENTER.lat,
    ];

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: initialCenter,
      zoom: DEFAULT_ZOOM,
    });

    mapRef.current = map;

    // Clean up on unmount
    return () => {
      map.remove();
      mapRef.current = null;
      pickupMarkerRef.current = null;
      dropoffMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // --- 2) UPDATE MARKERS + CAMERA WHEN PROPS CHANGE ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      // PICKUP MARKER
      if (isValidCoord(pickupLat, pickupLng)) {
        const pickupLngLat: [number, number] = [pickupLng as number, pickupLat as number];

        if (!pickupMarkerRef.current) {
          pickupMarkerRef.current = new mapboxgl.Marker({ color: "#1DB954" }) // green
            .setLngLat(pickupLngLat)
            .addTo(map);
        } else {
          pickupMarkerRef.current.setLngLat(pickupLngLat);
        }
      }

      // DROPOFF MARKER
      if (isValidCoord(dropoffLat, dropoffLng)) {
        const dropoffLngLat: [number, number] = [dropoffLng as number, dropoffLat as number];

        if (!dropoffMarkerRef.current) {
          dropoffMarkerRef.current = new mapboxgl.Marker({ color: "#FF5733" }) // orange
            .setLngLat(dropoffLngLat)
            .addTo(map);
        } else {
          dropoffMarkerRef.current.setLngLat(dropoffLngLat);
        }
      }

      // CAMERA / MOVEMENT
      const hasPickup = isValidCoord(pickupLat, pickupLng);
      const hasDropoff = isValidCoord(dropoffLat, dropoffLng);

      if (hasPickup && hasDropoff) {
        // Fit map to BOTH markers – clear visible movement
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([pickupLng as number, pickupLat as number]);
        bounds.extend([dropoffLng as number, dropoffLat as number]);

        map.fitBounds(bounds, {
          padding: 80,
          maxZoom: 15,
          duration: 900, // animation
        });
      } else if (hasPickup) {
        // Center on pickup
        map.flyTo({
          center: [pickupLng as number, pickupLat as number],
          zoom: 15,
          speed: 1.4,
        });
      } else if (hasDropoff) {
        // Center on dropoff
        map.flyTo({
          center: [dropoffLng as number, dropoffLat as number],
          zoom: 15,
          speed: 1.4,
        });
      } else {
        // No coords – go back to default Lagawe view
        map.flyTo({
          center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
          zoom: DEFAULT_ZOOM,
          speed: 1.2,
        });
      }
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once("load", update);
    }
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

  return (
    <div className="w-full h-full">
      {/* Optional header */}
      {bookingId && (
        <div className="mb-2 text-xs text-gray-600">
          Booking ID: <span className="font-mono font-semibold">{bookingId}</span>
        </div>
      )}

      {/* Map container */}
      <div
        ref={containerRef}
        className="w-full h-[520px] rounded-lg overflow-hidden border border-gray-200"
      />
    </div>
  );
}
