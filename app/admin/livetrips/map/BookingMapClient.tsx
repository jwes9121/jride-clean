"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Booking = Record<string, any>;

type Props = {
  bookingId: string | null;
};

type Coords = {
  lat: number;
  lng: number;
};

const DEFAULT_CENTER: Coords = {
  // JRide default center (adjust if you want)
  lat: 16.81,
  lng: 121.11,
};
const DEFAULT_ZOOM = 11;

/**
 * Try multiple possible field names for pickup coords so we don't break
 * even if prod and dev schemas are slightly different.
 */
function extractPickupCoords(booking: Booking | null): Coords | null {
  if (!booking) return null;

  const pairCandidates: [string, string][] = [
    ["pickup_lat", "pickup_lng"],
    ["pickup_latitude", "pickup_longitude"],
    ["pickup_location_lat", "pickup_location_lng"],
    ["pickup_point_lat", "pickup_point_lng"],
  ];

  for (const [latKey, lngKey] of pairCandidates) {
    const lat = booking[latKey];
    const lng = booking[lngKey];

    if (typeof lat === "number" && typeof lng === "number") {
      return { lat, lng };
    }
    if (typeof lat === "string" && typeof lng === "string") {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      if (!Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
        return { lat: latNum, lng: lngNum };
      }
    }
  }

  // Object style: pickup_location / pickup_point / pickup: { lat, lng } or { latitude, longitude }
  const objectKeys = ["pickup_location", "pickup_point", "pickup"];
  for (const key of objectKeys) {
    const val = booking[key];
    if (val && typeof val === "object") {
      const maybeLat = (val as any).lat ?? (val as any).latitude;
      const maybeLng = (val as any).lng ?? (val as any).longitude;

      if (typeof maybeLat === "number" && typeof maybeLng === "number") {
        return { lat: maybeLat, lng: maybeLng };
      }
      if (typeof maybeLat === "string" && typeof maybeLng === "string") {
        const latNum = parseFloat(maybeLat);
        const lngNum = parseFloat(maybeLng);
        if (!Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
          return { lat: latNum, lng: lngNum };
        }
      }
    }
  }

  return null;
}

export default function BookingMapClient({ bookingId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [center, setCenter] = useState<Coords>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [hasBookingCoords, setHasBookingCoords] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(!!bookingId);
  const [error, setError] = useState<string | null>(null);

  // Fetch booking details from API
  useEffect(() => {
    if (!bookingId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadBooking() {
      setLoading(true);
      setError(null);
      setHasBookingCoords(false);

      try {
        const res = await fetch(
          `/api/admin/livetrips/booking-map?bookingId=${encodeURIComponent(
            bookingId
          )}`
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const json = await res.json();
        const booking: Booking | null = json.booking ?? null;

        const coords = extractPickupCoords(booking);

        if (!cancelled) {
          if (coords) {
            setCenter(coords);
            setZoom(14);
            setHasBookingCoords(true);
          } else {
            // No coords found, fall back to default map
            setCenter(DEFAULT_CENTER);
            setZoom(DEFAULT_ZOOM);
            setHasBookingCoords(false);
          }
        }
      } catch (err: any) {
        console.error("Booking map fetch error", err);
        if (!cancelled) {
          setError(err?.message ?? "Failed to load booking.");
          setCenter(DEFAULT_CENTER);
          setZoom(DEFAULT_ZOOM);
          setHasBookingCoords(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadBooking();

    return () => {
      cancelled = true;
    };
  }, [bookingId]);

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
  }, [center.lat, center.lng, zoom]);

  // Re-center when center changes
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setCenter([center.lng, center.lat]);
  }, [center.lat, center.lng]);

  // Marker when we actually have booking coords
  useEffect(() => {
    if (!mapRef.current) return;
    if (!hasBookingCoords) return;

    const marker = new (mapboxgl as any)
      .Marker()
      .setLngLat([center.lng, center.lat])
      .addTo(mapRef.current);

    return () => {
      marker.remove();
    };
  }, [center.lat, center.lng, hasBookingCoords]);

  return (
    <div className="relative h-[480px] rounded-xl overflow-hidden border border-gray-200">
      <div className="absolute z-10 m-2 rounded bg-white/80 px-2 py-1 text-[10px] font-mono">
        {bookingId ? `Booking: ${bookingId}` : "No booking selected"}
        {loading ? " • loading…" : null}
        {hasBookingCoords ? " • pickup centered" : " • default view"}
      </div>

      {error && (
        <div className="absolute z-10 bottom-2 left-2 right-2 rounded bg-red-50 px-2 py-1 text-[10px] text-red-700">
          {error}
        </div>
      )}

      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
