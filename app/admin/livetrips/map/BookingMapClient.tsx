"use client";

import { useEffect, useRef, useState } from "react";
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

export default function BookingMapClient({
  bookingId,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);

  const pickupMarkerRef = useRef<any>(null);
  const dropoffMarkerRef = useRef<any>(null);

  const [center, setCenter] = useState<Coords>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);

  const [pickupCoords, setPickupCoords] = useState<Coords | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<Coords | null>(null);

  useEffect(() => {
    const pickup =
      typeof pickupLat === "number" &&
      !Number.isNaN(pickupLat) &&
      typeof pickupLng === "number" &&
      !Number.isNaN(pickupLng)
        ? { lat: pickupLat, lng: pickupLng }
        : null;

    const dropoff =
      typeof dropoffLat === "number" &&
      !Number.isNaN(dropoffLat) &&
      typeof dropoffLng === "number" &&
      !Number.isNaN(dropoffLng)
        ? { lat: dropoffLat, lng: dropoffLng }
        : null;

    setPickupCoords(pickup);
    setDropoffCoords(dropoff);

    // Decide initial center / zoom
    if (pickup && dropoff) {
      // center between pickup & dropoff
      setCenter({
        lat: (pickup.lat + dropoff.lat) / 2,
        lng: (pickup.lng + dropoff.lng) / 2,
      });
      setZoom(13);
    } else if (pickup) {
      setCenter(pickup);
      setZoom(14);
    } else if (dropoff) {
      setCenter(dropoff);
      setZoom(14);
    } else {
      setCenter(DEFAULT_CENTER);
      setZoom(DEFAULT_ZOOM);
    }
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const map = new (mapboxgl as any).Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [center.lng, center.lat],
      zoom,
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Re-center when center/zoom change
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setCenter([center.lng, center.lat]);
    mapRef.current.setZoom(zoom);
  }, [center.lat, center.lng, zoom]);

  // Pickup marker (blue)
  useEffect(() => {
    if (!mapRef.current) return;

    if (!pickupCoords) {
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.remove();
        pickupMarkerRef.current = null;
      }
      return;
    }

    if (pickupMarkerRef.current) {
      pickupMarkerRef.current.setLngLat([pickupCoords.lng, pickupCoords.lat]);
      return;
    }

    const marker = new (mapboxgl as any)
      .Marker({ color: "#2563eb" }) // blue
      .setLngLat([pickupCoords.lng, pickupCoords.lat])
      .addTo(mapRef.current);

    pickupMarkerRef.current = marker;

    return () => {
      marker.remove();
      pickupMarkerRef.current = null;
    };
  }, [pickupCoords]);

  // Dropoff marker (red)
  useEffect(() => {
    if (!mapRef.current) return;

    if (!dropoffCoords) {
      if (dropoffMarkerRef.current) {
        dropoffMarkerRef.current.remove();
        dropoffMarkerRef.current = null;
      }
      return;
    }

    if (dropoffMarkerRef.current) {
      dropoffMarkerRef.current.setLngLat([dropoffCoords.lng, dropoffCoords.lat]);
      return;
    }

    const marker = new (mapboxgl as any)
      .Marker({ color: "#dc2626" }) // red
      .setLngLat([dropoffCoords.lng, dropoffCoords.lat])
      .addTo(mapRef.current);

    dropoffMarkerRef.current = marker;

    return () => {
      marker.remove();
      dropoffMarkerRef.current = null;
    };
  }, [dropoffCoords]);

  const pickupLabel = pickupCoords ? "pickup" : "no pickup";
  const dropoffLabel = dropoffCoords ? "dropoff" : "no dropoff";

  return (
    <div className="relative h-[480px] rounded-xl overflow-hidden border border-gray-200">
      <div className="absolute z-10 m-2 rounded bg-white/80 px-2 py-1 text-[10px] font-mono">
        {bookingId ? `Booking: ${bookingId}` : "No booking selected"} •{" "}
        {pickupLabel} • {dropoffLabel}
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
