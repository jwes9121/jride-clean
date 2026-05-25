// app/admin/livetrips/components/LiveTripsMap.tsx
"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { LiveTrip } from "./ProblemTripAlertSounds";
import DispatchActionPanel from "./DispatchActionPanel";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export interface LiveTripsMapProps {
  trips: LiveTrip[];
  selectedTripId: string | null;
  stuckTripIds: Set<string>; // external optional stuck set
  drivers?: FleetDriver[];
}

// Fleet driver row coming from /api/admin/driver_locations
type FleetDriver = {
  driver_id?: string | null;
  id?: string | null;
  name?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  status?: string | null;
  updated_at?: string | null;
};

type LngLatTuple = [number, number];

function num(v: any): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// ---------- Coordinate helpers ----------

function getPickup(trip: any): LngLatTuple | null {
  const lat =
    num(trip.pickup_lat) ??
    num(trip.from_lat) ??
    num(trip.origin_lat);
  const lng =
    num(trip.pickup_lng) ??
    num(trip.from_lng) ??
    num(trip.origin_lng);
  if (lat != null && lng != null) return [lng, lat];
  return null;
}

function getDropoff(trip: any): LngLatTuple | null {
  const lat =
    num(trip.dropoff_lat) ??
    num(trip.to_lat) ??
    num(trip.dest_lat) ??
    num(trip.destination_lat);
  const lng =
    num(trip.dropoff_lng) ??
    num(trip.to_lng) ??
    num(trip.dest_lng) ??
    num(trip.destination_lng);
  if (lat != null && lng != null) return [lng, lat];
  return null;
}

function getExplicitDriver(trip: any): LngLatTuple | null {
  const lat =
    num(trip.driver_lat) ??
    num(trip.driverLat) ??
    num(trip.driver_latitude);
  const lng =
    num(trip.driver_lng) ??
    num(trip.driverLng) ??
    num(trip.driver_longitude);
  if (lat != null && lng != null) return [lng, lat];
  return null;
}

function fallbackDriverNearPickup(pickup: LngLatTuple | null): LngLatTuple | null {
  if (!pickup) return null;
  // small offset so driver marker isn't exactly on pickup marker
  return [pickup[0] + 0.00008, pickup[1] + 0.00008];
}

function statusKey(trip: any): string {
  return String(trip?.status ?? trip?.trip_status ?? "").toLowerCase();
}

function isStuckTrip(trip: any, stuckTripIds: Set<string>): boolean {
  const code = String(trip?.booking_code ?? trip?.bookingCode ?? trip?.id ?? "");
  if (code && stuckTripIds?.has(code)) return true;
  return Boolean(trip?.is_stuck || trip?.stuck);
}

function safeId(trip: any): string {
  return String(trip?.booking_code ?? trip?.bookingCode ?? trip?.id ?? "");
}

// ---------- Main Component ----------

export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({
  trips,
  selectedTripId,
  stuckTripIds,
  drivers = [],
}) => {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fleetMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const [mapReady, setMapReady] = useState(false);

  const [openTripId, setOpenTripId] = useState<string | null>(null);

  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastAlertedTripIdRef = useRef<string | null>(null);

  const [mapBounds, setMapBounds] = useState<mapboxgl.LngLatBounds | null>(null);

  const visibleTrips = useMemo(() => trips ?? [], [trips]);

  const driverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const pickupMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const dropMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});

  const mapStyle = useMemo(() => {
    return {
      width: "100%",
      height: "100%",
      minHeight: 480,
      borderRadius: 12,
      overflow: "hidden",
      border: "1px solid rgba(0,0,0,0.08)",
    } as React.CSSProperties;
  }, []);

  // ---------- Initialize Map ----------
function getDriverLabelText(trip: any): string {
  // Prefer jersey number if present (supports multiple possible field names)
  const jersey =
    trip.jersey ??
    trip.jersey_no ??
    trip.jersey_number ??
    trip.driver_jersey ??
    trip.driver_jersey_no ??
    trip.driver_jersey_number ??
    trip.driverJersey ??
    trip.driverJerseyNo ??
    null;

  const jerseyStr = jersey != null ? String(jersey).trim() : "";
  if (jerseyStr) return jerseyStr;

  const id =
    trip.driver_id ??
    trip.driverId ??
    trip.driver_uuid ??
    trip.driverUuid ??
    trip.id ??
    trip.uuid ??
    null;

  const idStr = id != null ? String(id).trim() : "";
  if (idStr.length >= 2) return idStr.slice(0, 2).toUpperCase();
  if (idStr.length === 1) return idStr.toUpperCase();

  return "";
}
  // Once user drags/zooms the map, stop auto-fit recentering
  const userInteractedRef = useRef(false);
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [121.0002, 16.9995],
        zoom: 10.6,
        attributionControl: false,
      });

      mapRef.current = map;    // Stop auto-fit once user interacts
    map.on("dragstart", () => { userInteractedRef.current = true; });
    map.on("zoomstart", () => { userInteractedRef.current = true; });
    map.on("rotatestart", () => { userInteractedRef.current = true; });
    map.on("pitchstart", () => { userInteractedRef.current = true; });


      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      map.on("load", () => {
        setMapReady(true);
      });

      map.on("moveend", () => {
        try {
          setMapBounds(map.getBounds());
        } catch {
          // ignore
        }
      });
    } catch (e) {
      console.error("[LiveTripsMap] map init error", e);
    }

    return () => {
      try {
        mapRef.current?.remove();
      } catch {
        // ignore
      }
      mapRef.current = null;
    };
  }, []);

  // ---------- Trip Markers ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const nextDriver: Record<string, mapboxgl.Marker> = {};
    const nextPickup: Record<string, mapboxgl.Marker> = {};
    const nextDrop: Record<string, mapboxgl.Marker> = {};

    for (let i = 0; i < visibleTrips.length; i++) {
      const t: any = visibleTrips[i];
      const id = safeId(t);
      if (!id) continue;

      const pickup = getPickup(t);
      const drop = getDropoff(t);
      const explicitDriver = getExplicitDriver(t);
      const driver = explicitDriver ?? fallbackDriverNearPickup(pickup);

      const st = statusKey(t);
      const isSelected = selectedTripId && id === selectedTripId;
      const isStuck = isStuckTrip(t, stuckTripIds);

      // Pickup marker
      if (pickup) {
        let m = pickupMarkersRef.current[id];
        if (!m) {
          const el = document.createElement("div");
          el.style.width = "12px";
          el.style.height = "12px";
          el.style.borderRadius = "9999px";
          el.style.background = isStuck ? "#ef4444" : "#0ea5e9";
          el.style.border = "2px solid #ffffff";
          el.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.10)";
          el.style.transform = "translate(-50%, -50%)";
          el.style.zIndex = isSelected ? "9998" : "10";
          if (isStuck) el.className = "jride-marker-blink";

          m = new mapboxgl.Marker(el).setLngLat(pickup).addTo(map);
        } else {
          m.setLngLat(pickup);
          const el = m.getElement();
          el.style.background = isStuck ? "#ef4444" : "#0ea5e9";
          el.style.zIndex = isSelected ? "9998" : "10";
          if (isStuck) el.classList.add("jride-marker-blink");
          else el.classList.remove("jride-marker-blink");
        }
        nextPickup[id] = m;
      }

      // Dropoff marker
      if (drop) {
        let m = dropMarkersRef.current[id];
        if (!m) {
          const el = document.createElement("div");
          el.style.width = "10px";
          el.style.height = "10px";
          el.style.borderRadius = "9999px";
          el.style.background = "#a855f7";
          el.style.border = "2px solid #ffffff";
          el.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.10)";
          el.style.transform = "translate(-50%, -50%)";
          el.style.zIndex = isSelected ? "9997" : "9";

          m = new mapboxgl.Marker(el).setLngLat(drop).addTo(map);
        } else {
          m.setLngLat(drop);
          m.getElement().style.zIndex = isSelected ? "9997" : "9";
        }
        nextDrop[id] = m;
      }

      // Driver marker (trip-derived)
      if (driver) {
        let m = driverMarkersRef.current[id];
        if (!m) {
          const el = document.createElement("div");
          el.style.width = "14px";
          el.style.height = "14px";
          el.style.borderRadius = "9999px";
          el.style.background = "#22c55e";
          el.style.border = "2px solid #ffffff";
          el.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.12)";
          el.style.transform = "translate(-50%, -50%)";
          el.style.zIndex = isSelected ? "9999" : "11";

          // label (status)
          const label = document.createElement("div");
          label.style.position = "absolute";
          label.style.left = "18px";
          label.style.top = "-2px";
          label.style.padding = "2px 6px";
          label.style.borderRadius = "9999px";
          label.style.background = "rgba(255,255,255,0.92)";
          label.style.border = "1px solid rgba(0,0,0,0.08)";
          label.style.fontSize = "11px";
          label.style.whiteSpace = "nowrap";
          label.style.color = "rgba(0,0,0,0.75)";
          label.setAttribute("data-jride-status-label", "1");
          label.textContent = st || "trip";
          el.appendChild(label);

          // badge (driver identity): jersey # else UUID prefix (2 chars)
          const badgeText = getDriverLabelText(t);
          if (badgeText) {
            const badge = document.createElement("div");
            badge.setAttribute("data-jride-driver-label", "1");
            badge.style.position = "absolute";
            badge.style.left = "50%";
            badge.style.top = "-12px";
            badge.style.transform = "translateX(-50%)";
            badge.style.padding = "1px 6px";
            badge.style.borderRadius = "9999px";
            badge.style.background = "rgba(0,0,0,0.75)";
            badge.style.border = "1px solid rgba(255,255,255,0.55)";
            badge.style.fontSize = "10px";
            badge.style.fontWeight = "700";
            badge.style.whiteSpace = "nowrap";
            badge.style.color = "#fff";
            badge.style.pointerEvents = "none";
            badge.textContent = badgeText;
            el.appendChild(badge);
          }

          m = new mapboxgl.Marker(el).setLngLat(driver).addTo(map);

          // click opens panel
          el.style.cursor = "pointer";
          el.onclick = (ev) => {
            ev.stopPropagation();
            setOpenTripId((prev) => (prev === id ? null : id));
          };
        } else {
          m.setLngLat(driver);
          const el = m.getElement();
          el.style.zIndex = isSelected ? "9999" : "11";
          const statusLabel = el.querySelector("[data-jride-status-label]");
          if (statusLabel) (statusLabel as HTMLDivElement).textContent = st || "trip";

          const driverBadge = el.querySelector("[data-jride-driver-label]");
          const badgeText = getDriverLabelText(t);
          if (driverBadge) {
            (driverBadge as HTMLDivElement).textContent = badgeText;
            (driverBadge as any).style.display = badgeText ? "block" : "none";
          } else if (badgeText) {
            const badge = document.createElement("div");
            badge.setAttribute("data-jride-driver-label", "1");
            badge.style.position = "absolute";
            badge.style.left = "50%";
            badge.style.top = "-12px";
            badge.style.transform = "translateX(-50%)";
            badge.style.padding = "1px 6px";
            badge.style.borderRadius = "9999px";
            badge.style.background = "rgba(0,0,0,0.75)";
            badge.style.border = "1px solid rgba(255,255,255,0.55)";
            badge.style.fontSize = "10px";
            badge.style.fontWeight = "700";
            badge.style.whiteSpace = "nowrap";
            badge.style.color = "#fff";
            badge.style.pointerEvents = "none";
            badge.textContent = badgeText;
            el.appendChild(badge);
          }
          
        }
        nextDriver[id] = m;
      }
    }

    // cleanup removed trips
    for (const [id, m] of Object.entries(pickupMarkersRef.current)) {
      if (!nextPickup[id]) m.remove();
    }
    for (const [id, m] of Object.entries(dropMarkersRef.current)) {
      if (!nextDrop[id]) m.remove();
    }
    for (const [id, m] of Object.entries(driverMarkersRef.current)) {
      if (!nextDriver[id]) m.remove();
    }

    pickupMarkersRef.current = nextPickup;
    dropMarkersRef.current = nextDrop;
    driverMarkersRef.current = nextDriver;
  }, [visibleTrips, selectedTripId, stuckTripIds, mapReady]);

  // ---------- Fleet markers (online drivers) ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
if (process.env.NODE_ENV !== "production") console.log("[FLEET] MAP READY", mapReady);
if (process.env.NODE_ENV !== "production") console.log("[FLEET] MAP REF", !!mapRef.current);
if (process.env.NODE_ENV !== "production") console.log("[FLEET] DRIVERS IN HOOK", (drivers ?? []).length);
if (process.env.NODE_ENV !== "production") console.log("[FLEET] BEFORE KEYS", Object.keys(fleetMarkersRef.current));
    const next: Record<string, mapboxgl.Marker> = {};

    for (const d of drivers as any[]) {
      const id = String(d?.driver_id ?? d?.id ?? "");
      const lat = num(d?.lat);
      const lng = num(d?.lng);
      if (!id || lat == null || lng == null) continue;

      // --- JRIDE: stale driver styling (minutes=10) ---
      let ageMin = 0;
      try {
        const tsRaw = (d?.updated_at ?? d?.updatedAt ?? null);
        if (tsRaw) {
          const ts = new Date(tsRaw);
          const now = Date.now();
          ageMin = (now - ts.getTime()) / 60000;
        }
      } catch {
        ageMin = 0;
      }
      const isStale = ageMin > 10;
      // --- end stale styling ---
const ll: LngLatTuple = [lng, lat];

      let m = fleetMarkersRef.current[id];
      if (!m) {
        const el = document.createElement("div");
        el.style.width = "12px";
        el.style.height = "12px";
        el.style.borderRadius = "9999px";
        el.style.background = (isStale ? "#9ca3af" : "#22c55e"); // gray if stale, green if fresh
        el.title = `Driver ${id}  ${isStale ? "stale " + Math.round(ageMin) + "m" : "fresh"}`;
        el.style.border = "2px solid #ffffff";
        el.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.10)";
        el.style.transform = "translate(-50%, -50%)";
        el.style.zIndex = "9999";

        m = new mapboxgl.Marker(el).setLngLat(ll).addTo(map);
      } else {
        m.setLngLat(ll);
        try {
          const el = m.getElement();
          el.style.background = (isStale ? "#9ca3af" : "#22c55e");
          el.title = `Driver ${id}  ${isStale ? "stale " + Math.round(ageMin) + "m" : "fresh"}`;
        } catch {}
      }

      next[id] = m;
    }

    // cleanup removed drivers
    for (const [id, m] of Object.entries(fleetMarkersRef.current)) {
      if (!next[id]) m.remove();
    }

    fleetMarkersRef.current = next;
if (process.env.NODE_ENV !== "production") console.log("[FLEET] AFTER KEYS", Object.keys(fleetMarkersRef.current));
  }, [drivers, mapReady]);

  // ---------- Fit map to markers ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const coords: LngLatTuple[] = [];

    // include fleet coords too (so trips=0 still fits)
    for (const d of drivers as any[]) {
      const lat = num(d?.lat);
      const lng = num(d?.lng);
      if (lat != null && lng != null) coords.push([lng, lat]);
    }

    for (const t of visibleTrips as any[]) {
      const pickup = getPickup(t);
      const drop = getDropoff(t);
      const drv = getExplicitDriver(t);
      if (pickup) coords.push(pickup);
      if (drop) coords.push(drop);
      if (drv) coords.push(drv);
    }

    if (!coords.length) return;

    const b = new mapboxgl.LngLatBounds(coords[0], coords[0]);
    for (const c of coords) b.extend(c);

    try {
      if (!userInteractedRef.current) map.fitBounds(b, { padding: 90, maxZoom: 14, duration: 700 });
    } catch {
      // ignore
    }
  }, [visibleTrips, drivers, mapReady]);

  // ---------- Audio alert for stuck trips ----------
  useEffect(() => {
    const stuck = (visibleTrips as any[]).find((t) => isStuckTrip(t, stuckTripIds));
    if (!stuck) return;

    const id = safeId(stuck);
    if (!id) return;

    if (lastAlertedTripIdRef.current === id) return;
    lastAlertedTripIdRef.current = id;

    try {
      alertAudioRef.current?.play().catch(() => {});
    } catch {
      // ignore
    }
  }, [visibleTrips, stuckTripIds]);

  return (
    <>
      <div className="relative w-full">
        <div ref={containerRef} style={mapStyle} />

        {openTripId && (
          <div className="absolute left-3 top-3 z-[10000] w-[360px] max-w-[92vw] rounded-xl border bg-white shadow-lg">
            <DispatchActionPanel
  bookingCode={openTripId as any}
  dispatcherName={undefined}
/>
          </div>
        )}

        {/* Hidden audio element */}
        <audio
          ref={alertAudioRef}
          src="/audio/jride_audio.mp3"
          preload="auto"
        />
      </div>

      <style jsx global>{`
        .jride-marker-blink {
          animation: jride-pulse 1.3s infinite;
        }
        @keyframes jride-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          }
          70% {
            box-shadow: 0 0 0 16px rgba(239, 68, 68, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
        }
      `}</style>
    </>
  );
};

export default LiveTripsMap;

