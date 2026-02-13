"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { getTripEta, TripEtaPhase as TripEtaPhaseType } from "@/lib/tripEtaCalc";
import TripEtaPhase from "@/components/trip/TripEtaPhase";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// Data coming from admin_active_trips_v1
export interface Booking {
  id: number | string;
  booking_code: string;
  passenger_name?: string | null;
  pickup_label?: string | null;
  dropoff_label?: string | null;
  zone?: string | null;
  town?: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  status: string;

  driver_id?: string | null;
  driver_lat?: number | null;
  driver_lng?: number | null;
  driver_status?: string | null;
  driver_town?: string | null;
}

interface BookingMapClientProps {
  booking?: Booking | null;
  height?: number | string;
  onClose?: () => void;
}

export default function BookingMapClient(props: BookingMapClientProps) {
  const { booking, height = 420, onClose } = props;

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dropoffMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [etaLoading, setEtaLoading] = useState(false);

  // ---------- Init / cleanup Map ----------
  useEffect(() => {
    // If there is no booking yet, do nothing.
    if (!booking) return;
    if (typeof window === "undefined") return;
    if (!mapboxgl.accessToken) {
      console.warn("[BookingMapClient] NEXT_PUBLIC_MAPBOX_TOKEN is missing.");
      return;
    }
    if (!mapContainerRef.current) return;

    // Remove previous map instance if any
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const center: [number, number] = [
      booking.pickup_lng || 121.059,
      booking.pickup_lat || 16.811,
    ];

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center,
      zoom: 14,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      addMarkersAndRoute();
    });

    function addMarkersAndRoute() {
      if (!booking) return;
      const map = mapRef.current;
      if (!map) return;

      // Clear old markers
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.remove();
        pickupMarkerRef.current = null;
      }
      if (dropoffMarkerRef.current) {
        dropoffMarkerRef.current.remove();
        dropoffMarkerRef.current = null;
      }

      // ----- Pickup marker (green) -----
      const pickupEl = document.createElement("div");
      pickupEl.style.width = "18px";
      pickupEl.style.height = "18px";
      pickupEl.style.borderRadius = "50%";
      pickupEl.style.backgroundColor = "#10B981"; // green
      pickupEl.style.boxShadow = "0 0 4px rgba(0,0,0,0.4)";
      pickupEl.style.border = "2px solid white";

      pickupMarkerRef.current = new mapboxgl.Marker({
        element: pickupEl,
        anchor: "center",
      })
        .setLngLat([booking.pickup_lng, booking.pickup_lat])
        .addTo(map);

      // ----- Dropoff marker (red) -----
      const dropoffEl = document.createElement("div");
      dropoffEl.style.width = "18px";
      dropoffEl.style.height = "18px";
      dropoffEl.style.borderRadius = "50%";
      dropoffEl.style.backgroundColor = "#EF4444"; // red
      dropoffEl.style.boxShadow = "0 0 4px rgba(0,0,0,0.4)";
      dropoffEl.style.border = "2px solid white";

      dropoffMarkerRef.current = new mapboxgl.Marker({
        element: dropoffEl,
        anchor: "center",
      })
        .setLngLat([booking.dropoff_lng, booking.dropoff_lat])
        .addTo(map);

      // ----- Driver marker (simple blue dot for now) -----
      const realLat =
        typeof booking.driver_lat === "number" ? booking.driver_lat : null;
      const realLng =
        typeof booking.driver_lng === "number" ? booking.driver_lng : null;

      let driverLat = realLat;
      let driverLng = realLng;

      if (driverLat === null || driverLng === null) {
        // Fallback to pickup so we ALWAYS see a marker for testing
        driverLat = booking.pickup_lat;
        driverLng = booking.pickup_lng;
      }

      console.log("[BookingMapClient] driver marker position", {
        bookingCode: booking.booking_code,
        realLat,
        realLng,
        driverLat,
        driverLng,
      });

      if (driverLat !== null && driverLng !== null) {
        const driverEl = document.createElement("div");
        driverEl.style.width = "32px";
driverEl.style.height = "32px";
driverEl.style.backgroundImage = "url('/icons/jride-trike.png')";
driverEl.style.backgroundSize = "contain";
driverEl.style.backgroundRepeat = "no-repeat";
driverEl.style.backgroundPosition = "center";

// Remove blue circle styling
driverEl.style.backgroundColor = "transparent";
driverEl.style.border = "none";
driverEl.style.borderRadius = "0";
driverEl.style.boxShadow = "none";


        driverMarkerRef.current = new mapboxgl.Marker({
          element: driverEl,
          anchor: "center",
        })
          .setLngLat([driverLng, driverLat])
          .addTo(map);
      }

      // Fit bounds to pickup, dropoff, and driver
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([booking.pickup_lng, booking.pickup_lat]);
      bounds.extend([booking.dropoff_lng, booking.dropoff_lat]);
      if (driverLat !== null && driverLng !== null) {
        bounds.extend([driverLng, driverLat]);
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, duration: 800 });
      }

      // Draw route line
      addRouteLine(realLat, realLng);
    }

    async function addRouteLine(realLat: number | null, realLng: number | null) {
      if (!booking) return;
      const map = mapRef.current;
      if (!map) return;
      const token = mapboxgl.accessToken;
      if (!token) return;

      let originLng: number;
      let originLat: number;
      let destLng: number;
      let destLat: number;

      if (booking.status === "on_trip") {
        if (realLat !== null && realLng !== null) {
          originLng = realLng;
          originLat = realLat;
        } else {
          originLng = booking.pickup_lng;
          originLat = booking.pickup_lat;
        }
        destLng = booking.dropoff_lng;
        destLat = booking.dropoff_lat;
      } else {
        if (realLat !== null && realLng !== null) {
          originLng = realLng;
          originLat = realLat;
        } else {
          originLng = booking.pickup_lng;
          originLat = booking.pickup_lat;
        }
        destLng = booking.pickup_lng;
        destLat = booking.pickup_lat;
      }

      const profile = "mapbox/cycling";
      const coords = `${originLng},${originLat};${destLng},${destLat}`;
      const url = new URL(
        `https://api.mapbox.com/directions/v5/${profile}/${coords}`
      );
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("overview", "full");
      url.searchParams.set("access_token", token);

      try {
        const res = await fetch(url.toString());
        if (!res.ok) {
          console.error("[BookingMapClient] Directions error:", res.status, res.statusText);
          return;
        }
        const data = await res.json();
        if (!data.routes || !data.routes[0]) {
          console.warn("[BookingMapClient] No route returned from Mapbox.");
          return;
        }

        const route = data.routes[0];
        const geojson = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: route.geometry,
              properties: {},
            },
          ],
        };

        // Safely remove any existing route
        if ((map as any).getLayer && (map as any).getSource) {
          if (map.getLayer("jride-route")) {
            map.removeLayer("jride-route");
          }
          if (map.getSource("jride-route")) {
            map.removeSource("jride-route");
          }
        }

        map.addSource("jride-route", {
          type: "geojson",
          data: geojson as any,
        });

        map.addLayer({
          id: "jride-route",
          type: "line",
          source: "jride-route",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-width": 5,
            "line-opacity": 0.8,
            "line-color": "#2563EB",
          },
        });
      } catch (err) {
        console.error("[BookingMapClient] Error while adding route:", err);
      }
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      driverMarkerRef.current = null;
      pickupMarkerRef.current = null;
      dropoffMarkerRef.current = null;
    };
  }, [booking]); // <- booking can be undefined; effect just returns early

  // ---------- ETA ----------
  useEffect(() => {
    if (!booking) return;

    const pickup = { lat: booking.pickup_lat, lng: booking.pickup_lng };
    const dropoff = { lat: booking.dropoff_lat, lng: booking.dropoff_lng };

    const realLat =
      typeof booking.driver_lat === "number" ? booking.driver_lat : null;
    const realLng =
      typeof booking.driver_lng === "number" ? booking.driver_lng : null;

    const driver =
      realLat !== null && realLng !== null ? { lat: realLat, lng: realLng } : null;

    let phase: TripEtaPhaseType =
      booking.status === "on_trip" ? "on_trip" : "to_pickup";

    let cancelled = false;

    async function runEta() {
      setEtaLoading(true);
      const result = await getTripEta({
        driver: driver ?? undefined,
        pickup,
        dropoff,
        phase,
      });
      if (!cancelled) {
        setEtaMinutes(result.etaMinutes);
        setDistanceKm(result.distanceKm);
        setEtaLoading(false);
      }
    }

    runEta();
    const interval = setInterval(runEta, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [booking]); // same guard

  const title = booking
    ? booking.booking_code
      ? `JRide ${booking.booking_code}`
      : `Booking ${booking.id}`
    : "No live trip selected";

  // If there is still no booking, show a simple placeholder panel (no map)
  if (!booking) {
    return (
      <div className="flex flex-col h-full w-full">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-gray-400">
              Live Trip Map
            </span>
            <span className="text-sm font-semibold text-gray-800">
              {title}
            </span>
          </div>
        </div>
        <div className="flex-1 w-full flex items-center justify-center text-xs text-gray-400 bg-gray-50">
          Select a trip on the left to view the map.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wide text-gray-400">
            Live Trip Map
          </span>
          <span className="text-sm font-semibold text-gray-800">
            {title}
          </span>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
            {booking.pickup_label && <span>{booking.pickup_label}</span>}
            <span>→</span>
            {booking.dropoff_label && <span>{booking.dropoff_label}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <TripEtaPhase
            etaMinutes={etaMinutes}
            distanceKm={distanceKm}
            status={booking.status}
            loading={etaLoading}
          />
          {onClose && (
            <button
              onClick={onClose}
              className="mt-1 text-[11px] px-2 py-1 border border-gray-300 rounded-full hover:bg-gray-100"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Map */}
      <div
        ref={mapContainerRef}
        style={{
          height: typeof height === "number" ? `${height}px` : height,
        }}
        className="w-full bg-gray-100"
      />
    </div>
  );
}
