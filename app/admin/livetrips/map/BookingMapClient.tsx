"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Booking = Record<string, any>;

type DriverLocation = {
  driver_id: string;
  lat: number | null;
  lng: number | null;
  status?: string | null;
  town?: string | null;
};

type Props = {
  bookingId: string | null;
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

/**
 * Try multiple possible field names for pickup coords so we don't break
 * even if schema changes slightly.
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

function extractDriverCoords(driverLocation: DriverLocation | null): Coords | null {
  if (!driverLocation) return null;
  const { lat, lng } = driverLocation;
  if (typeof lat === "number" && typeof lng === "number") {
    return { lat, lng };
  }
  return null;
}

export default function BookingMapClient({ bookingId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);

  const pickupMarkerRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);

  const [center, setCenter] = useState<Coords>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);

  const [hasBookingCoords, setHasBookingCoords] = useState<boolean>(false);
  const [hasDriverCoords, setHasDriverCoords] = useState<boolean>(false);

  const [driverCoords, setDriverCoords] = useState<Coords | null>(null);

  const [loading, setLoading] = useState<boolean>(!!bookingId);
  const [error, setError] = useState<string | null>(null);

  // Fetch booking + driverLocation from API
  useEffect(() => {
    if (!bookingId) {
      setLoading(false);
      return;
    }

    const id = bookingId; // narrowed to string
    let cancelled = false;

    async function loadBooking() {
      setLoading(true);
      setError(null);
      setHasBookingCoords(false);
      setHasDriverCoords(false);
      setDriverCoords(null);

      try {
        const res = await fetch(
          `/api/admin/livetrips/booking-map?bookingId=${encodeURIComponent(id)}`
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const json = await res.json();
        const booking: Booking | null = json.booking ?? null;
        const driverLocation: DriverLocation | null = json.driverLocation ?? null;

        const pickup = extractPickupCoords(booking);
        const driver = extractDriverCoords(driverLocation);

        if (!cancelled) {
          if (pickup) {
            setCenter(pickup);
            setZoom(14);
            setHasBookingCoords(true);
          } else {
            setCenter(DEFAULT_CENTER);
            setZoom(DEFAULT_ZOOM);
            setHasBookingCoords(false);
          }

          if (driver) {
            setDriverCoords(driver);
            setHasDriverCoords(true);
          } else {
            setDriverCoords(null);
            setHasDriverCoords(false);
          }
        }
      } catch (err: any) {
        console.error("Booking map fetch error", err);
        if (!cancelled) {
          setError(err?.message ?? "Failed to load booking.");
          setCenter(DEFAULT_CENTER);
          setZoom(DEFAULT_ZOOM);
          setHasBookingCoords(false);
          setDriverCoords(null);
          setHasDriverCoords(false);
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

  // Pickup marker
  useEffect(() => {
    if (!mapRef.current) return;

    if (!hasBookingCoords) {
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.remove();
        pickupMarkerRef.current = null;
      }
      return;
    }

    // If marker exists, just move it
    if (pickupMarkerRef.current) {
      pickupMarkerRef.current.setLngLat([center.lng, center.lat]);
      return;
    }

    const marker = new (mapboxgl as any)
      .Marker({ color: "#2563eb" }) // blue-ish for pickup
      .setLngLat([center.lng, center.lat])
      .addTo(mapRef.current);

    pickupMarkerRef.current = marker;

    return () => {
      marker.remove();
      pickupMarkerRef.current = null;
    };
  }, [center.lat, center.lng, hasBookingCoords]);

  // Driver marker
  useEffect(() => {
    if (!mapRef.current) return;

    if (!hasDriverCoords || !driverCoords) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
      return;
    }

    const { lat, lng } = driverCoords;

    // If marker exists, move it
    if (driverMarkerRef.current) {
      driverMarkerRef.current.setLngLat([lng, lat]);
      return;
    }

    const marker = new (mapboxgl as any)
      .Marker({ color: "#16a34a" }) // green-ish for driver
      .setLngLat([lng, lat])
      .addTo(mapRef.current);

    driverMarkerRef.current = marker;

    return () => {
      marker.remove();
      driverMarkerRef.current = null;
    };
  }, [driverCoords, hasDriverCoords]);

  // Optional: if we have both pickup + driver, fit bounds to show both
  useEffect(() => {
    if (!mapRef.current) return;
    if (!hasBookingCoords || !hasDriverCoords || !driverCoords) return;

    const bounds = new (mapboxgl as any).LngLatBounds();
    bounds.extend([center.lng, center.lat]);
    bounds.extend([driverCoords.lng, driverCoords.lat]);

    mapRef.current.fitBounds(bounds, { padding: 60 });
  }, [center.lat, center.lng, hasBookingCoords, hasDriverCoords, driverCoords]);

  return (
    <div className="relative h-[480px] rounded-xl overflow-hidden border border-gray-200">
      <div className="absolute z-10 m-2 rounded bg-white/80 px-2 py-1 text-[10px] font-mono">
        {bookingId ? `Booking: ${bookingId}` : "No booking selected"}
        {loading ? " • loading…" : null}
        {hasBookingCoords ? " • pickup centered" : " • default view"}
        {hasDriverCoords ? " • driver located" : " • no driver position"}
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
