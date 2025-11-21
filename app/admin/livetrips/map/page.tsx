"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

type SearchParams = {
  bookingId?: string;
  pickupLat?: string;
  pickupLng?: string;
  dropoffLat?: string;
  dropoffLng?: string;
};

interface PageProps {
  searchParams?: SearchParams;
}

type LatLng = {
  lat: number;
  lng: number;
};

export default function BookingMapPage({ searchParams = {} }: PageProps) {
  const supabase = createClientComponentClient();

  const bookingId = (searchParams.bookingId ?? "") as string;

  const pickupLatRaw = searchParams.pickupLat ?? "";
  const pickupLngRaw = searchParams.pickupLng ?? "";
  const dropoffLatRaw = searchParams.dropoffLat ?? "";
  const dropoffLngRaw = searchParams.dropoffLng ?? "";

  const pickupLat = Number.parseFloat(pickupLatRaw || "0");
  const pickupLng = Number.parseFloat(pickupLngRaw || "0");
  const dropoffLat = dropoffLatRaw ? Number.parseFloat(dropoffLatRaw) : null;
  const dropoffLng = dropoffLngRaw ? Number.parseFloat(dropoffLngRaw) : null;

  // Driver for this booking (from bookings.assigned_driver_id)
  const [driverId, setDriverId] = useState<string | null>(null);

  // Current live driver location (from driver_locations)
  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(
    Number.isFinite(pickupLat) && Number.isFinite(pickupLng)
      ? { lat: pickupLat, lng: pickupLng }
      : null,
  );

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dropoffMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // 1) Fetch assigned_driver_id for this booking once
  useEffect(() => {
    if (!bookingId) return;

    const fetchBooking = async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("assigned_driver_id")
        .eq("id", bookingId)
        .maybeSingle();

      if (error) {
        console.error("BOOKING_FETCH_ERROR", error);
        return;
      }

      if (data?.assigned_driver_id) {
        setDriverId(data.assigned_driver_id as string);
      } else {
        console.warn("No assigned_driver_id for booking", bookingId, data);
      }
    };

    fetchBooking();
  }, [bookingId, supabase]);

  // 2) Poll driver_locations every 3 seconds for this driver
  useEffect(() => {
    if (!driverId) return;

    let isCancelled = false;

    const fetchLatestLocation = async () => {
      const { data, error } = await supabase
        .from("driver_locations")
        .select("lat, lng, updated_at")
        .eq("driver_id", driverId)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("DRIVER_LOCATION_FETCH_ERROR", error);
        return;
      }

      if (!data || !data[0]) return;

      const row = data[0] as any;
      const lat = typeof row.lat === "number" ? row.lat : null;
      const lng = typeof row.lng === "number" ? row.lng : null;

      if (!isCancelled && lat != null && lng != null) {
        setCurrentLocation({ lat, lng });
      }
    };

    // first immediate fetch
    fetchLatestLocation();

    const intervalId = setInterval(fetchLatestLocation, 3000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [driverId, supabase]);

  // 3) Initialise Mapbox map + static pickup / dropoff markers
  //    This runs once (based on static pickup/dropoff), no currentLocation dependency.
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const hasPickup =
      Number.isFinite(pickupLat) && Number.isFinite(pickupLng);

    const center: [number, number] = hasPickup
      ? [pickupLng, pickupLat]
      : [121.11, 16.8219]; // default Lamut-ish center

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center,
      zoom: 13,
    });

    mapRef.current = map;

    // Pickup marker
    if (hasPickup) {
      const pickupMarker = new mapboxgl.Marker({ color: "#2563eb" }) // blue
        .setLngLat([pickupLng, pickupLat])
        .addTo(map);
      pickupMarkerRef.current = pickupMarker;
    }

    // Dropoff marker (if provided)
    if (
      dropoffLat !== null &&
      dropoffLng !== null &&
      Number.isFinite(dropoffLat) &&
      Number.isFinite(dropoffLng)
    ) {
      const dropoffMarker = new mapboxgl.Marker({ color: "#dc2626" }) // red
        .setLngLat([dropoffLng, dropoffLat])
        .addTo(map);
      dropoffMarkerRef.current = dropoffMarker;
    }

    return () => {
      driverMarkerRef.current?.remove();
      pickupMarkerRef.current?.remove();
      dropoffMarkerRef.current?.remove();
      map.remove();
    };
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

  // 4) Whenever currentLocation changes, update driver marker + center
  useEffect(() => {
    if (!currentLocation) return;

    const map = mapRef.current;
    if (!map) return;

    let marker = driverMarkerRef.current;

    if (!marker) {
      marker = new mapboxgl.Marker({ color: "#16a34a" }) // green
        .setLngLat([currentLocation.lng, currentLocation.lat])
        .addTo(map);
      driverMarkerRef.current = marker;
    } else {
      marker.setLngLat([currentLocation.lng, currentLocation.lat]);
    }

    map.easeTo({
      center: [currentLocation.lng, currentLocation.lat],
      duration: 800,
    });
  }, [currentLocation]);

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <div className="p-4 border-b text-sm">
        <div className="font-semibold text-lg">Booking map</div>
        <div className="text-xs text-gray-600">
          Live JRide map view for dispatch. Booking details can be wired here.
        </div>
        <div className="mt-1 text-xs">
          Booking:{" "}
          <span className="font-mono">
            {bookingId || "Unknown booking"}
          </span>
          {" · "}
          pickup{" "}
          {Number.isFinite(pickupLat) && Number.isFinite(pickupLng)
            ? `${pickupLat.toFixed(5)}, ${pickupLng.toFixed(5)}`
            : "n/a"}
          {dropoffLat !== null &&
            dropoffLng !== null &&
            Number.isFinite(dropoffLat) &&
            Number.isFinite(dropoffLng) && (
              <>
                {" · "}dropoff{" "}
                {`${dropoffLat.toFixed(5)}, ${dropoffLng.toFixed(5)}`}
              </>
            )}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          Driver (from booking): {driverId ?? "none assigned"}
        </div>
      </div>
      <div className="flex-1">
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
