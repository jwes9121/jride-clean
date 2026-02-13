"use client";

import React, { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

type AnyRecord = Record<string, any>;

type EtaInfo = {
  minutes: number;
  km: number;
};

type BookingMapClientProps = {
  bookingId?: string | null;
  bookingCode?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  driverId?: string | null;
  booking?: AnyRecord;
  onEtaUpdate?: (eta: {
    pickup?: EtaInfo | null;
    trip?: EtaInfo | null;
  }) => void;
};

type LatLng = {
  lat: number;
  lng: number;
};

function toLatLng(lat: any, lng: any): LatLng | null {
  if (lat === null || lat === undefined) return null;
  if (lng === null || lng === undefined) return null;

  const nLat = Number(lat);
  const nLng = Number(lng);

  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null;

  return { lat: nLat, lng: nLng };
}

// Map official town colors -> used for driver halo
function getTownColors(townRaw: any): { bg: string; border: string } {
  const town = (townRaw ?? "").toString().toLowerCase();

  if (town.includes("lagawe")) {
    // maroon
    return { bg: "#7f1d1d", border: "#b91c1c" };
  }
  if (town.includes("kiangan")) {
    // light green
    return { bg: "#16a34a", border: "#22c55e" };
  }
  if (town.includes("lamut")) {
    return { bg: "#f97316", border: "#ea580c" };
  }
  if (town.includes("hingyon")) {
    return { bg: "#0ea5e9", border: "#0369a1" };
  }
  if (town.includes("banaue")) {
    return { bg: "#4f46e5", border: "#4338ca" };
  }

  // default JRide teal
  return { bg: "#0f766e", border: "#14b8a6" };
}

export default function BookingMapClient({
  booking,
  onEtaUpdate,
}: BookingMapClientProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dropoffMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const routeIdRef = useRef<string>("jride-booking-route");

  // Derive coordinates from booking, with fallbacks to different field names.
  const pickup = useMemo<LatLng | null>(() => {
    return (
      toLatLng(booking?.pickup_lat, booking?.pickup_lng) ??
      toLatLng(booking?.from_lat, booking?.from_lng) ??
      null
    );
  }, [booking]);

  const dropoff = useMemo<LatLng | null>(() => {
    return (
      toLatLng(booking?.dropoff_lat, booking?.dropoff_lng) ??
      toLatLng(booking?.to_lat, booking?.to_lng) ??
      null
    );
  }, [booking]);

  const driver = useMemo<LatLng | null>(() => {
    return (
      toLatLng(booking?.driver_lat, booking?.driver_lng) ??
      toLatLng(
        booking?.driver?.lat ?? booking?.driver?.latitude,
        booking?.driver?.lng ?? booking?.driver?.longitude
      ) ??
      null
    );
  }, [booking]);

  const driverTown = useMemo<string | null>(() => {
    return (
      booking?.zone ??
      booking?.town ??
      booking?.driver?.town ??
      null
    );
  }, [booking]);

  // Initial map creation
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const center: LatLng =
      driver ?? pickup ?? dropoff ?? { lat: 16.8003, lng: 121.1153 }; // Kiangan-ish fallback

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [center.lng, center.lat],
      zoom: 14,
    });

    map.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      "top-right"
    );

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [driver, pickup, dropoff]);

  // Update markers + road-following route + ETAs
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const routeId = routeIdRef.current;

    const updateMap = async () => {
      // reset ETAs while loading
      if (onEtaUpdate) {
        onEtaUpdate({ pickup: null, trip: null });
      }

      // Wait until style is fully loaded to avoid "Style is not done loading"
      if (!map.isStyleLoaded()) {
        await new Promise<void>((resolve) => {
          const onLoad = () => {
            map.off("load", onLoad);
            resolve();
          };
          map.on("load", onLoad);
        });
      }

      // Remove old route if present
      if (map.getLayer(routeId)) {
        map.removeLayer(routeId);
      }
      if (map.getSource(routeId)) {
        map.removeSource(routeId);
      }

      // Remove old markers
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.remove();
        pickupMarkerRef.current = null;
      }
      if (dropoffMarkerRef.current) {
        dropoffMarkerRef.current.remove();
        dropoffMarkerRef.current = null;
      }
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }

      const bounds = new mapboxgl.LngLatBounds();

      // Pickup marker (green)
      if (pickup) {
        const el = document.createElement("div");
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "999px";
        el.style.backgroundColor = "#22c55e";
        el.style.border = "2px solid white";
        el.style.boxShadow = "0 0 4px rgba(0,0,0,0.35)";

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([pickup.lng, pickup.lat])
          .addTo(map);

        pickupMarkerRef.current = marker;
        bounds.extend([pickup.lng, pickup.lat]);
      }

      // Dropoff marker (red)
      if (dropoff) {
        const el = document.createElement("div");
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "999px";
        el.style.backgroundColor = "#ef4444";
        el.style.border = "2px solid white";
        el.style.boxShadow = "0 0 4px rgba(0,0,0,0.35)";

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([dropoff.lng, dropoff.lat])
          .addTo(map);

        dropoffMarkerRef.current = marker;
        bounds.extend([dropoff.lng, dropoff.lat]);
      }

      // Driver marker (JRide trike + town-colored halo)
      if (driver) {
        const colors = getTownColors(driverTown);

        const wrapper = document.createElement("div");
        wrapper.style.position = "relative";
        wrapper.style.width = "32px";
        wrapper.style.height = "32px";

        const halo = document.createElement("div");
        halo.style.position = "absolute";
        halo.style.inset = "0";
        halo.style.borderRadius = "999px";
        halo.style.backgroundColor = colors.bg;
        halo.style.border = `2px solid ${colors.border}`;
        halo.style.boxShadow = "0 0 6px rgba(0,0,0,0.45)";

        const icon = document.createElement("div");
        icon.style.position = "absolute";
        icon.style.inset = "4px";
        icon.style.borderRadius = "999px";
        icon.style.backgroundImage = "url('/icons/jride-trike.png')";
        icon.style.backgroundSize = "contain";
        icon.style.backgroundRepeat = "no-repeat";
        icon.style.backgroundPosition = "center";
        icon.style.backgroundColor = "white";

        wrapper.appendChild(halo);
        wrapper.appendChild(icon);

        const marker = new mapboxgl.Marker({ element: wrapper })
          .setLngLat([driver.lng, driver.lat])
          .addTo(map);

        driverMarkerRef.current = marker;
        bounds.extend([driver.lng, driver.lat]);
      }

      let pickupEta: EtaInfo | null = null;
      let tripEta: EtaInfo | null = null;

      // Build route coordinates using Mapbox Directions API (pickup -> dropoff)
      let coordinates: [number, number][] = [];

      if (pickup && dropoff) {
        try {
          const token = mapboxgl.accessToken;
          const url =
            `https://api.mapbox.com/directions/v5/mapbox/driving/` +
            `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}` +
            `?geometries=geojson&overview=full&access_token=${token}`;

          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const route = data?.routes?.[0];
            const routeCoords =
              route?.geometry?.coordinates as [number, number][] | undefined;

            if (Array.isArray(routeCoords) && routeCoords.length > 1) {
              coordinates = routeCoords;
            }

            if (route?.duration && route?.distance) {
              const minutes = route.duration / 60; // seconds -> minutes
              const km = route.distance / 1000; // meters -> km
              tripEta = { minutes, km };
            }
          } else {
            console.error("[BookingMapClient] Directions API failed", res.status);
          }
        } catch (err) {
          console.error("[BookingMapClient] Directions error", err);
        }

        // Fallback: straight line if Directions fails
        if (!coordinates.length) {
          coordinates = [
            [pickup.lng, pickup.lat],
            [dropoff.lng, dropoff.lat],
          ];
        }

        // Add route source + layer
        map.addSource(routeId, {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates,
                },
                properties: {},
              },
            ],
          },
        });

        map.addLayer({
          id: routeId,
          type: "line",
          source: routeId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#2563eb",
            "line-width": 4,
          },
        });

        // Extend bounds to all route points
        coordinates.forEach(([lng, lat]) => {
          bounds.extend([lng, lat]);
        });
      }

      // ETA pickup: driver -> pickup
      if (driver && pickup) {
        try {
          const token = mapboxgl.accessToken;
          const url =
            `https://api.mapbox.com/directions/v5/mapbox/driving/` +
            `${driver.lng},${driver.lat};${pickup.lng},${pickup.lat}` +
            `?geometries=geojson&overview=full&access_token=${token}`;

          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const route = data?.routes?.[0];
            if (route?.duration && route?.distance) {
              const minutes = route.duration / 60;
              const km = route.distance / 1000;
              pickupEta = { minutes, km };
            }
          } else {
            console.error(
              "[BookingMapClient] Directions API (pickup) failed",
              res.status
            );
          }
        } catch (err) {
          console.error("[BookingMapClient] Directions error (pickup)", err);
        }
      }

      // Fit bounds so everything is visible
      const hasBounds =
        (bounds as any).isEmpty && typeof (bounds as any).isEmpty === "function"
          ? !(bounds as any).isEmpty()
          : true;

      if (hasBounds) {
        map.fitBounds(bounds, {
          padding: { top: 40, bottom: 40, left: 40, right: 40 },
          duration: 500,
        });
      } else if (driver) {
        map.easeTo({
          center: [driver.lng, driver.lat],
          zoom: 15,
          duration: 500,
        });
      }

      // Push ETAs up to parent
      if (onEtaUpdate) {
        onEtaUpdate({ pickup: pickupEta, trip: tripEta });
      }
    };

    void updateMap();
  }, [pickup, dropoff, driver, driverTown, booking, onEtaUpdate]);

  return (
    <div className="w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full rounded-b-lg md:rounded-b-none md:rounded-r-lg overflow-hidden"
      />
    </div>
  );
}



