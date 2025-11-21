"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Booking = {
  id: string;
  booking_code: string;
  status: string;
  assigned_driver_id: string | null;
  from_label?: string | null;
  to_label?: string | null;
  pickup_lat?: any;
  pickup_lng?: any;
  dropoff_lat?: any;
  dropoff_lng?: any;
  created_at?: string;
};

type DriverLocation = {
  driver_id: string;
  lat: any;
  lng: any;
  status?: string | null;
  town?: string | null;
  updated_at?: string | null;
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

// Coerce anything (number/string) to a finite number or return null
function toNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractPickupCoords(booking: Booking | null): Coords | null {
  if (!booking) return null;
  const lat = toNumber(booking.pickup_lat);
  const lng = toNumber(booking.pickup_lng);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

function extractDropoffCoords(booking: Booking | null): Coords | null {
  if (!booking) return null;
  const lat = toNumber(booking.dropoff_lat);
  const lng = toNumber(booking.dropoff_lng);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

function extractDriverCoords(driverLocation: DriverLocation | null): Coords | null {
  if (!driverLocation) return null;
  const lat = toNumber(driverLocation.lat);
  const lng = toNumber(driverLocation.lng);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

export default function BookingMapClient({ bookingId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);

  const pickupMarkerRef = useRef<any>(null);
  const dropoffMarkerRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);

  const [center, setCenter] = useState<Coords>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);

  const [bookingStatus, setBookingStatus] = useState<string | null>(null);

  const [pickupCoords, setPickupCoords] = useState<Coords | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<Coords | null>(null);
  const [driverCoords, setDriverCoords] = useState<Coords | null>(null);

  const [rawPickup, setRawPickup] = useState<{ lat: any; lng: any } | null>(null);
  const [rawDropoff, setRawDropoff] = useState<{ lat: any; lng: any } | null>(null);

  const [loading, setLoading] = useState<boolean>(!!bookingId);
  const [error, setError] = useState<string | null>(null);

  // Fetch booking + driverLocation from API
  useEffect(() => {
    if (!bookingId) {
      setLoading(false);
      return;
    }

    const id = bookingId;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/admin/livetrips/booking-map?bookingId=${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const json = await res.json();
        const booking: Booking | null = json.booking ?? null;
        const driverLocation: DriverLocation | null = json.driverLocation ?? null;

        if (cancelled) return;

        const pickup = extractPickupCoords(booking);
        const dropoff = extractDropoffCoords(booking);
        const driver = extractDriverCoords(driverLocation);

        setPickupCoords(pickup);
        setDropoffCoords(dropoff);
        setDriverCoords(driver);

        if (booking) {
          setRawPickup({ lat: booking.pickup_lat, lng: booking.pickup_lng });
          setRawDropoff({ lat: booking.dropoff_lat, lng: booking.dropoff_lng });
        } else {
          setRawPickup(null);
          setRawDropoff(null);
        }

        const status =
          booking && typeof booking.status === "string"
            ? booking.status
            : null;
        setBookingStatus(status);

        // Decide initial center/zoom based on status + available coords
        let newCenter: Coords = DEFAULT_CENTER;
        let newZoom = DEFAULT_ZOOM;

        if (pickup) {
          newCenter = pickup;
          newZoom = 14;
        } else if (driver) {
          newCenter = driver;
          newZoom = 14;
        } else if (dropoff) {
          newCenter = dropoff;
          newZoom = 14;
        }

        if (status === "in_progress" && driver) {
          newCenter = driver;
          newZoom = 14;
        }

        if ((status === "completed" || status === "cancelled") && dropoff) {
          newCenter = dropoff;
          newZoom = 14;
        }

        setCenter(newCenter);
        setZoom(newZoom);
      } catch (err: any) {
        console.error("Booking map fetch error", err);
        if (!cancelled) {
          setError(err?.message ?? "Failed to load booking.");
          setPickupCoords(null);
          setDropoffCoords(null);
          setDriverCoords(null);
          setBookingStatus(null);
          setCenter(DEFAULT_CENTER);
          setZoom(DEFAULT_ZOOM);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

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

  // Driver marker (green)
  useEffect(() => {
    if (!mapRef.current) return;

    if (!driverCoords) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
      return;
    }

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setLngLat([driverCoords.lng, driverCoords.lat]);
      return;
    }

    const marker = new (mapboxgl as any)
      .Marker({ color: "#16a34a" }) // green
      .setLngLat([driverCoords.lng, driverCoords.lat])
      .addTo(mapRef.current);

    driverMarkerRef.current = marker;

    return () => {
      marker.remove();
      driverMarkerRef.current = null;
    };
  }, [driverCoords]);

  // Fit bounds when we have multiple points
  useEffect(() => {
    if (!mapRef.current) return;

    const points: [number, number][] = [];

    if (pickupCoords) {
      points.push([pickupCoords.lng, pickupCoords.lat]);
    }
    if (dropoffCoords) {
      points.push([dropoffCoords.lng, dropoffCoords.lat]);
    }
    if (driverCoords) {
      points.push([driverCoords.lng, driverCoords.lat]);
    }

    if (points.length < 2) return;

    const bounds = new (mapboxgl as any).LngLatBounds();
    for (const p of points) {
      bounds.extend(p);
    }

    mapRef.current.fitBounds(bounds, { padding: 60 });
  }, [pickupCoords, dropoffCoords, driverCoords]);

  const statusLabel = bookingStatus ?? "unknown";

  const pickupLabel = pickupCoords ? "pickup" : "no pickup";
  const dropoffLabel = dropoffCoords ? "dropoff" : "no dropoff";
  const driverLabel = driverCoords ? "driver located" : "no driver position";

  const rawPickupStr =
    rawPickup && (rawPickup.lat !== null || rawPickup.lng !== null)
      ? `raw pickup: (${String(rawPickup.lat)}, ${String(rawPickup.lng)})`
      : "raw pickup: null";

  const rawDropoffStr =
    rawDropoff && (rawDropoff.lat !== null || rawDropoff.lng !== null)
      ? `raw dropoff: (${String(rawDropoff.lat)}, ${String(rawDropoff.lng)})`
      : "raw dropoff: null";

  return (
    <div className="relative h-[480px] rounded-xl overflow-hidden border border-gray-200">
      <div className="absolute z-10 m-2 rounded bg-white/80 px-2 py-1 text-[10px] font-mono space-y-0.5">
        <div>
          {bookingId ? `Booking: ${bookingId}` : "No booking selected"}
          {loading ? " • loading…" : null}{" "}
          • status: {statusLabel}
          {" • "}
          {pickupLabel}
          {" • "}
          {dropoffLabel}
          {" • "}
          {driverLabel}
        </div>
        <div>{rawPickupStr}</div>
        <div>{rawDropoffStr}</div>
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
