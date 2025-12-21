"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { LiveTrip } from "./ProblemTripAlertSounds";
import { DispatchActionPanel } from "./DispatchActionPanel";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export interface LiveTripsMapProps {
  trips: LiveTrip[];
  selectedTripId: string | null;
  stuckTripIds: Set<string>; // external optional stuck set
}

type LngLatTuple = [number, number];

function num(v: any): number | null {

function tripKey(raw: any, fallbackIdx?: number): string {
  if (!raw) return String(fallbackIdx ?? "");
  const v =
    raw.uuid ??
    raw.id ??
    raw.booking_code ??
    raw.bookingCode ??
    raw.bookingcode ??
    raw.code ??
    null;
  const s = String(v ?? (fallbackIdx ?? "")).trim();
  return s;
}

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

/**
 * Fallback: collect all coords and infer a driver position
 */
function getAllCoords(trip: any): LngLatTuple[] {
  if (!trip || typeof trip !== "object") return [];
  const entries = Object.entries(trip) as [string, any][];
  const lowers = entries.map(([k, v]) => [k.toLowerCase(), v] as [string, any]);

  const latKeys: Record<string, string> = {};
  const lngKeys: Record<string, string> = {};

  for (const [key, value] of lowers) {
    const n = num(value);
    if (n == null) continue;

    if (key.includes("lat")) {
      const base = key.replace("latitude", "").replace("lat", "");
      latKeys[base] = key;
    }
    if (key.includes("lng") || key.includes("lon") || key.includes("long")) {
      const base = key
        .replace("longitude", "")
        .replace("long", "")
        .replace("lng", "")
        .replace("lon", "");
      lngKeys[base] = key;
    }
  }

  const coords: LngLatTuple[] = [];
  const bases = new Set<string>([...Object.keys(latKeys), ...Object.keys(lngKeys)]);
  for (const base of bases) {
    const latKey = latKeys[base];
    const lngKey = lngKeys[base];
    if (!latKey || !lngKey) continue;

    const lat = num((trip as any)[latKey]);
    const lng = num((trip as any)[lngKey]);
    if (lat == null || lng == null) continue;

    coords.push([lng, lat]);
  }

  return coords;
}

/**
 * Driver position priority:
 * 1) explicit driver_* fields
 * 2) from all coords:
 *    - 1 coord  => that coord
 *    - 2 coords => second coord
 *    - 3+       => second-to-last coord
 */
function getDriverReal(trip: any): LngLatTuple | null {
  const explicit = getExplicitDriver(trip);
  if (explicit) return explicit;

  const coords = getAllCoords(trip);
  if (!coords.length) return null;
  if (coords.length === 1) return coords[0];
  if (coords.length === 2) return coords[1];
  return coords[coords.length - 2];
}

/**
 * Display position for the trike icon: slightly south of real driver position
 * so the destination red dot (at true coords) never sits on top of it.
 */
function getDriverDisplay(real: LngLatTuple | null): LngLatTuple | null {
  if (!real) return null;
  const [lng, lat] = real;
  // ~20m south
  const offsetLat = lat - 0.00018;
  return [lng, offsetLat];
}

function distanceMeters(a: LngLatTuple, b: LngLatTuple): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const sa = Math.sin(dLat / 2);
  const sb = Math.sin(dLng / 2);
  const c =
    2 *
    Math.atan2(
      Math.sqrt(
        sa * sa +
          Math.cos((a[1] * Math.PI) / 180) *
            Math.cos((b[1] * Math.PI) / 180) *
            sb * sb
      ),
      Math.sqrt(1 - sa * sa)
    );
  return R * c;
}

/**
 * Road-following route via Mapbox Directions.
 * Returns straight line if anything fails.
 */
async function getRoadRoute(
  start: LngLatTuple,
  end: LngLatTuple
): Promise<any> {
  const straight: any = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [start, end],
    },
    properties: {},
  };

  try {
    if (!mapboxgl.accessToken) return straight;

    const url =
      "https://api.mapbox.com/directions/v5/mapbox/driving/" +
      `${start[0]},${start[1]};${end[0]},${end[1]}` +
      `?geometries=geojson&overview=full&access_token=${encodeURIComponent(
        mapboxgl.accessToken
      )}`;

    const res = await fetch(url);
    if (!res.ok) return straight;

    const json: any = await res.json();
    const geometry: any = json?.routes?.[0]?.geometry;

    if (!geometry || geometry.type !== "LineString") return straight;

    return {
      type: "Feature",
      geometry,
      properties: {},
    };
  } catch {
    return straight;
  }
}

// ---------- Zone helpers ----------

function getZoneName(trip: any): string {
  return (
    (trip.town ??
      trip.zone ??
      trip.area ??
      trip.municipality ??
      "Unknown") as string
  );
}

function normalizeZone(name: string): string {
  return name.trim().toLowerCase();
}

// ---------- Auto-assign suggestion types ----------

interface AutoAssignSuggestion {
  tripId: string;
  bookingCode?: string;
  driverName?: string;
  driverId?: string;
  driverTown?: string | null;
  distanceMeters?: number;
  reason: string;
  score: number;
}

// ---------- Main component ----------

export const LiveTripsMap: React.FC<LiveTripsMapProps> = ({
  trips,
  selectedTripId,
  stuckTripIds,
}) => {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const driverMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const pickupMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const dropMarkersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const routeIdsRef = useRef<Set<string>>(new Set());
  const lastFollowRef = useRef<LngLatTuple | null>(null);

  // Audio for problem-trip alerts
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const alertedIdsRef = useRef<Set<string>>(new Set());

  // ===== STUCK TRIP WATCHER (internal) =====
  type TrackState = {
    lastPos: LngLatTuple | null;
    lastMoveTime: number;
    isStuck: boolean;
  };
  const trackerRef = useRef<Record<string, TrackState>>({});
  const [localStuckIds, setLocalStuckIds] = useState<Set<string>>(new Set());

  const MOVE_THRESHOLD_M = 25; // >25m counts as movement
  const STUCK_MS = 3 * 60 * 1000; // 3 minutes => stuck

  useEffect(() => {
    const now = Date.now();
    const tracker = trackerRef.current;

    for (let i = 0; i < trips.length; i++) {
      const raw = trips[i] as any;
      const id = tripKey(raw, i);

      const driverReal =
        getDriverReal(raw) ?? getDropoff(raw) ?? getPickup(raw);
      if (!driverReal) continue;

      const prev = tracker[id] ?? {
        lastPos: driverReal,
        lastMoveTime: now,
        isStuck: false,
      };

      if (prev.lastPos) {
        const dist = distanceMeters(prev.lastPos, driverReal);
        if (dist > MOVE_THRESHOLD_M) {
          prev.lastPos = driverReal;
          prev.lastMoveTime = now;
          prev.isStuck = false;
        } else {
          if (now - prev.lastMoveTime > STUCK_MS) {
            prev.isStuck = true;
          }
        }
      } else {
        prev.lastPos = driverReal;
        prev.lastMoveTime = now;
        prev.isStuck = false;
      }

      tracker[id] = prev;
    }

    const idsNow = new Set(
      trips.map((t: any, idx) =>
        String((t as any).id ?? (t as any).bookingCode ?? idx)
      )
    );
    for (const id of Object.keys(tracker)) {
      if (!idsNow.has(id)) delete tracker[id];
    }

    const stuck = new Set<string>();
    for (const [id, state] of Object.entries(tracker)) {
      if (state.isStuck) stuck.add(id);
    }
    setLocalStuckIds(stuck);
  }, [trips]);

  const activeStuckIds =
    stuckTripIds && stuckTripIds.size > 0 ? stuckTripIds : localStuckIds;

  // ===== AUTO PROBLEM-TRIP ALERT SOUND =====
  useEffect(() => {
    const audio = alertAudioRef.current;
    if (!audio) return;

    const currentProblemIds = new Set<string>();

    for (const tRaw of trips as any[]) {
      const id = tripKey(tRaw);
      const isStuck = activeStuckIds.has(id);
      const isProblem = !!tRaw.isProblem;
      if (isStuck || isProblem) {
        currentProblemIds.add(id);
      }
    }

    const already = alertedIdsRef.current;
    const newOnes: string[] = [];

    currentProblemIds.forEach((id) => {
      if (!already.has(id)) {
        already.add(id);
        newOnes.push(id);
      }
    });

    for (const id of Array.from(already)) {
      if (!currentProblemIds.has(id)) {
        already.delete(id);
      }
    }

    if (newOnes.length > 0) {
      try {
        audio.currentTime = 0;
        void audio.play();
      } catch {
        // ignore play errors
      }
    }
  }, [trips, activeStuckIds]);

  // ===== ZONE COLUMN FILTERS =====
  const [zoneFilter, setZoneFilter] = useState<string>("all");

  const zoneStats = useMemo(() => {
    const map: Record<string, { key: string; label: string; count: number }> =
      {};
    for (const t of trips as any[]) {
      const label = getZoneName(t);
      const key = normalizeZone(label);
      if (!key) continue;
      if (!map[key]) map[key] = { key, label, count: 0 };
      map[key].count++;
    }
    return Object.values(map).sort((a, b) =>
      a.label.localeCompare(b.label, "en")
    );
  }, [trips]);

  const visibleTrips = useMemo(() => {
    if (zoneFilter === "all") return trips;
    return trips.filter(
      (t: any) => normalizeZone(getZoneName(t)) === zoneFilter
    );
  }, [trips, zoneFilter]);

  // ===== KPI BANNER =====
  const kpi = useMemo(() => {
    let active = 0;
    let pending = 0;
    let problem = 0;
    let stuck = 0;
    let etaSum = 0;
    let etaCount = 0;

    for (const tRaw of trips as any[]) {
      const status = String(tRaw.status ?? "");
      const id = tripKey(tRaw);
      const isStuck = activeStuckIds.has(id);
      const isProblem = !!tRaw.isProblem;

      if (["pending", "assigned", "on_the_way", "on_trip"].includes(status)) {
        active++;
      }
      if (["pending", "assigned"].includes(status)) pending++;
      if (isProblem) problem++;
      if (isStuck) stuck++;

      const etaSeconds =
        num(tRaw.pickup_eta_seconds) ??
        (num(tRaw.pickup_eta_minutes) != null
          ? ((num(tRaw.pickup_eta_minutes) as number) * 60)
          : null) ??
        num(tRaw.eta_pickup_seconds) ??
        (num(tRaw.eta_pickup_minutes) != null
          ? ((num(tRaw.eta_pickup_minutes) as number) * 60)
          : null);

      if (etaSeconds != null) {
        etaSum += etaSeconds;
        etaCount++;
      }
    }

    const avgPickupEtaSeconds = etaCount ? etaSum / etaCount : null;
    const atRisk = Math.max(0, active - pending - (problem + stuck));

    return {
      active,
      pending,
      problem,
      stuck,
      atRisk,
      avgPickupEtaSeconds,
    };
  }, [trips, activeStuckIds]);

  // ===== AUTO-ASSIGN SUGGESTIONS =====
  const [suggestions, setSuggestions] = useState<AutoAssignSuggestion[]>([]);

  useEffect(() => {
    const pending = trips.filter((t: any) =>
      ["pending", "assigned"].includes((t.status ?? "").toString())
    );
    const drivers = trips.filter((t: any) =>
      ["idle", "available", "on_the_way", "on_trip"].includes(
        (t.status ?? "").toString()
      )
    );

    const next: AutoAssignSuggestion[] = [];

    for (const p of pending as any[]) {
      const pickup = getPickup(p);
      if (!pickup) continue;

      const pTown = (p.town ?? p.zone ?? p.area ?? null) as string | null;

      let best: AutoAssignSuggestion | null = null;

      for (const d of drivers as any[]) {
        const driverReal = getDriverReal(d);
        if (!driverReal) continue;

        const dTown = (d.town ?? d.zone ?? d.area ?? null) as string | null;
        const dist = distanceMeters(pickup, driverReal);

        let penalty = 0;
        if (pTown && dTown && pTown !== dTown) {
          penalty += 2000;
        }

        const score = dist + penalty;

        if (!best || score < best.score) {
          best = {
            tripId: String(p.id ?? p.bookingCode ?? ""),
            bookingCode: p.bookingCode,
            driverName: d.driver_name ?? d.driverName ?? null,
            driverId: d.driver_id ?? d.driverId ?? null,
            driverTown: dTown,
            distanceMeters: dist,
            reason: pTown && dTown && pTown !== dTown
              ? "Nearest driver but from another town"
              : "Nearest available driver",
            score,
          };
        }
      }

      if (best) next.push(best);
    }

    next.sort((a, b) => a.score - b.score);
    setSuggestions(next.slice(0, 3));
  }, [trips]);

  // ===== SELECTED DRIVER LIVE OVERVIEW =====
  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return (
      (trips.find(
        (t: any) =>
          tripKey(t) === selectedTripId
      ) as any) ?? null
    );
  }, [trips, selectedTripId]);

  const selectedOverview = useMemo(() => {
    if (!selectedTrip) return null;

    const id = tripKey(selectedTrip);
    const driverName =
      selectedTrip.driver_name ?? selectedTrip.driverName ?? null;
    const status = String(selectedTrip.status ?? "");
    const zoneLabel = getZoneName(selectedTrip);
    const isStuck = activeStuckIds.has(id) || !!selectedTrip.isProblem;

    const driverReal = getDriverReal(selectedTrip);
    const pickup = getPickup(selectedTrip);
    const drop = getDropoff(selectedTrip);

    let distToPickup: number | null = null;
    let distToDrop: number | null = null;
    if (driverReal && pickup) distToPickup = distanceMeters(driverReal, pickup);
    if (driverReal && drop) distToDrop = distanceMeters(driverReal, drop);

    const bookingCode = (selectedTrip.bookingCode ?? selectedTrip.booking_code) ?? id;
    const lastUpdate =
      selectedTrip.driver_last_seen_at ??
      selectedTrip.updated_at ??
      selectedTrip.inserted_at ??
      null;

    return {
      id,
      driverName,
      status,
      zoneLabel,
      isStuck,
      distToPickup,
      distToDrop,
      bookingCode,
      lastUpdate,
    };
  }, [selectedTrip, activeStuckIds]);

  // ===== INIT MAP =====
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [121.1, 16.8],
      zoom: 13,
    });
    mapRef.current = map;

    const onLoad = () => setMapReady(true);
    map.on("load", onLoad);
    if (map.isStyleLoaded()) setMapReady(true);
    return () => {
      map.off("load", onLoad);
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ===== MARKERS + ROUTES =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!mapReady) return;
    const nextDrivers: Record<string, mapboxgl.Marker> = {};
    const nextPickups: Record<string, mapboxgl.Marker> = {};
    const nextDrops: Record<string, mapboxgl.Marker> = {};
    const validRouteIds = new Set<string>();

    for (let i = 0; i < visibleTrips.length; i++) {
      const raw = visibleTrips[i] as any;
      const id = tripKey(raw, i);

      const driverReal = getDriverReal(raw);
      const driverDisplay = getDriverDisplay(driverReal);
      const pickup = getPickup(raw);
      const drop = getDropoff(raw);

      const isStuck = activeStuckIds.has(id);
      const isProblem = !!raw.isProblem;

      // DRIVER marker
      if (driverDisplay) {
        let marker = driverMarkersRef.current[id];
        if (!marker) {
          const el = document.createElement("img");
          el.src = "/icons/jride-trike.png";
          el.style.width = "42px";
          el.style.height = "42px";
          el.style.transform = "translate(-50%, -50%)";
          if (isStuck || isProblem) el.classList.add("jride-marker-blink");
          marker = new mapboxgl.Marker(el).setLngLat(driverDisplay).addTo(map);
        } else {
          marker.setLngLat(driverDisplay);
          const el = marker.getElement();
          if (isStuck || isProblem) {
            el.classList.add("jride-marker-blink");
          } else {
            el.classList.remove("jride-marker-blink");
          }
        }
        nextDrivers[id] = marker;
      }

      // PICKUP
      if (pickup) {
        let marker = pickupMarkersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.style.width = "14px";
          el.style.height = "14px";
          el.style.borderRadius = "9999px";
          el.style.backgroundColor = "#22c55e";
          el.style.border = "2px solid #ffffff";
          el.style.transform = "translate(-50%, -50%)";
          marker = new mapboxgl.Marker(el).setLngLat(pickup).addTo(map);
        } else {
          marker.setLngLat(pickup);
        }
        nextPickups[id] = marker;
      }

      // DROPOFF
      if (drop) {
        let marker = dropMarkersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.style.width = "14px";
          el.style.height = "14px";
          el.style.borderRadius = "9999px";
          el.style.backgroundColor = "#ef4444";
          el.style.border = "2px solid #ffffff";
          el.style.transform = "translate(-50%, -50%)";
          marker = new mapboxgl.Marker(el).setLngLat(drop).addTo(map);
        } else {
          marker.setLngLat(drop);
        }
        nextDrops[id] = marker;
      }

      // ROUTE
      const routeId = `route-road-${id}`;

      if (pickup && drop) {
        validRouteIds.add(routeId);

        void (async () => {
          const feature = await getRoadRoute(pickup, drop);
          const data: any = {
            type: "FeatureCollection",
            features: [feature],
          };

          const existing = map.getSource(routeId) as mapboxgl.GeoJSONSource | undefined;
          if (existing) {
            existing.setData(data);
          } else {
            map.addSource(routeId, {
              type: "geojson",
              data,
            });

            map.addLayer({
              id: routeId,
              type: "line",
              source: routeId,
              paint: {
                "line-color": "#16a34a",
                "line-width": 5,
              },
            });
          }
        })();
      } else {
        if (map.getLayer(routeId)) map.removeLayer(routeId);
        if (map.getSource(routeId)) map.removeSource(routeId);
      }
    }

    const map2 = mapRef.current;
    if (map2) {
      for (const [id, marker] of Object.entries(driverMarkersRef.current)) {
        if (!nextDrivers[id]) marker.remove();
      }
      for (const [id, marker] of Object.entries(pickupMarkersRef.current)) {
        if (!nextPickups[id]) marker.remove();
      }
      for (const [id, marker] of Object.entries(dropMarkersRef.current)) {
        if (!nextDrops[id]) marker.remove();
      }

      for (const prevId of routeIdsRef.current) {
        if (!validRouteIds.has(prevId)) {
          if (map2.getLayer(prevId)) map2.removeLayer(prevId);
          if (map2.getSource(prevId)) map2.removeSource(prevId);
        }
      }
    }

    driverMarkersRef.current = nextDrivers;
    pickupMarkersRef.current = nextPickups;
    dropMarkersRef.current = nextDrops;
    routeIdsRef.current = validRouteIds;
  }, [visibleTrips, activeStuckIds, mapReady]);

  // ===== AUTO-FOLLOW =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedTripId) return;

    const raw = trips.find(
      (t: any) => tripKey(t) === selectedTripId
    ) as any | undefined;
    if (!raw) return;

    const driverReal = getDriverReal(raw);
    const pickup = getPickup(raw);
    const drop = getDropoff(raw);

    const target: LngLatTuple | null = driverReal ?? drop ?? pickup ?? null;
    if (!target) return;

    if (lastFollowRef.current) {
      const dist = distanceMeters(lastFollowRef.current, target);
      if (dist < 30) return;
    }

    lastFollowRef.current = target;

    map.flyTo({
      center: target,
      zoom: 15,
      speed: 1.2,
      essential: true,
    });
  }, [selectedTripId, trips]);

  // ===== RENDER =====
  return (
    <>
      <div className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />

        {/* KPI BANNER */}
        <div className="pointer-events-auto absolute top-3 right-3 z-20 flex max-w-xl flex-wrap gap-2 rounded-xl bg-white/90 px-3 py-2 text-xs shadow-md">
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2 rounded-md bg-rose-50 px-2 py-1 text-rose-800">
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                Problem trips
              </span>
              <span className="text-sm font-bold">
                {kpi.problem + kpi.stuck}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1 text-amber-800">
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                At risk
              </span>
              <span className="text-sm font-bold">{kpi.atRisk}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                Active trips
              </span>
              <span className="text-sm font-bold">{kpi.active}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-slate-800">
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                Pending
              </span>
              <span className="text-sm font-bold">{kpi.pending}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-slate-800">
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                Avg pickup ETA
              </span>
              <span className="text-sm font-bold">
                {kpi.avgPickupEtaSeconds == null
                  ? "--"
                  : `${Math.round(kpi.avgPickupEtaSeconds / 60)} min`}
              </span>
            </div>
          </div>
        </div>

        {/* ZONE COLUMN FILTERS */}
        <div className="pointer-events-auto absolute top-3 left-3 z-20 max-w-xl rounded-xl bg-white/90 px-3 py-2 text-xs shadow-md">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-800">
              Zones workload
            </span>
            <button
              type="button"
              onClick={() => setZoneFilter("all")}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
          {zoneStats.length === 0 ? (
            <div className="text-[11px] text-slate-500">
              No active zones.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {zoneStats.map((z) => {
                const isActive = zoneFilter === z.key;
                return (
                  <button
                    key={z.key}
                    type="button"
                    onClick={() =>
                      setZoneFilter((prev) => (prev === z.key ? "all" : z.key))
                    }
                    className={[
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                      isActive
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span>{z.label}</span>
                    <span
                      className={[
                        "rounded-full px-1 text-[10px]",
                        isActive
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-700",
                      ].join(" ")}
                    >
                      {z.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* AUTO-ASSIGN OVERLAY */}
        <div className="pointer-events-auto absolute bottom-3 left-3 z-20 max-w-xs rounded-xl bg-white/90 p-3 text-xs shadow-md">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold text-slate-800">
              Auto-assign suggestions
            </span>
            <span className="text-[10px] text-slate-400">(beta helper)</span>
          </div>
          {suggestions.length === 0 ? (
            <div className="text-[11px] text-slate-500">
              No pending trips needing suggestions right now.
            </div>
          ) : (
            <ul className="space-y-1">
              {suggestions.map((s) => (
                <li
                  key={s.tripId}
                  className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1"
                >
                  <div className="text-[11px] font-semibold text-emerald-800">
                    Trip {s.bookingCode ?? s.tripId}
                  </div>
                  <div className="text-[11px] text-slate-700">
                    Suggest:{" "}
                    <span className="font-medium">
                      {s.driverName ??
                        (s.driverId ? `Driver ${s.driverId}` : "Nearest driver")}
                    </span>
                    {s.driverTown ? ` (${s.driverTown})` : null}
                  </div>
                  {s.distanceMeters != null && (
                    <div className="text-[10px] text-slate-500">
                      ~{(s.distanceMeters / 1000).toFixed(2)} km away ·{" "}
                      {s.reason}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* DRIVER LIVE OVERVIEW + DISPATCH ACTION PANEL */}
        {selectedOverview && (
          <div className="pointer-events-auto absolute bottom-3 right-3 z-20 w-80 rounded-xl bg-white/90 p-3 text-xs shadow-md space-y-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-slate-800">
                Driver live overview
              </span>
              <span className="text-[10px] text-slate-400">
                {selectedOverview.bookingCode}
              </span>
            </div>
            <div className="space-y-1 text-[11px] text-slate-700">
              <div className="flex justify-between">
                <span className="text-slate-500">Driver</span>
                <span className="font-medium">
                  {selectedOverview.driverName ?? "Unknown"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status</span>
                <span className="font-medium">
                  {selectedOverview.status}
                  {selectedOverview.isStuck ? " · STUCK" : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Zone</span>
                <span className="font-medium">
                  {selectedOverview.zoneLabel}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">To pickup</span>
                <span className="font-medium">
                  {selectedOverview.distToPickup == null
                    ? "--"
                    : `${(selectedOverview.distToPickup / 1000).toFixed(2)} km`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">To dropoff</span>
                <span className="font-medium">
                  {selectedOverview.distToDrop == null
                    ? "--"
                    : `${(selectedOverview.distToDrop / 1000).toFixed(2)} km`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Last update</span>
                <span className="font-medium">
                  {selectedOverview.lastUpdate
                    ? String(selectedOverview.lastUpdate)
                    : "—"}
                </span>
              </div>
            </div>

            <DispatchActionPanel
              selectedTrip={
                selectedTrip && selectedTrip.id
                  ? {
                      id: tripKey(selectedTrip),
                      booking_code:
                        (selectedTrip.bookingCode ?? selectedTrip.booking_code) ?? selectedOverview.bookingCode,
                      status:
                        selectedTrip.status ?? selectedOverview.status,
                      driver_id:
                        selectedTrip.driver_id ??
                        selectedTrip.driverId ??
                        null,
                      driver_name:
                        selectedTrip.driver_name ??
                        selectedTrip.driverName ??
                        selectedOverview.driverName ??
                        null,
                      driver_phone:
                        selectedTrip.driver_phone ??
                        selectedTrip.driverPhone ??
                        null,
                      passenger_name:
                        selectedTrip.passenger_name ??
                        selectedTrip.passengerName ??
                        null,
                      town:
                        selectedTrip.town ??
                        selectedTrip.zone ??
                        selectedOverview.zoneLabel ??
                        null,
                      is_emergency:
                        selectedTrip.is_emergency ??
                        selectedTrip.isEmergency ??
                        false,
                    }
                  : null
              }
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






