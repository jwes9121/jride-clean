# fix-livetrips-full.ps1
# Rebuilds Live Trips (Dispatch) files so that selected booking + map coords work.

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"

function Backup-File {
    param([string]$Path)
    if (Test-Path $Path) {
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupPath = "$Path.bak-$timestamp"
        Copy-Item $Path $backupPath -Force
        Write-Host "📦 Backup created: $backupPath"
    } else {
        Write-Host "ℹ️ No existing file at $Path (nothing to backup)."
    }
}

$livetripsDir  = Join-Path $root "app\admin\livetrips"
$actionsDir    = Join-Path $livetripsDir "actions"
$componentsDir = Join-Path $livetripsDir "components"
$mapDir        = Join-Path $livetripsDir "map"

New-Item -ItemType Directory -Force -Path $livetripsDir, $actionsDir, $componentsDir, $mapDir | Out-Null

# --------------------------------------------------------------------
# 1) page.tsx  (server component – loads data and passes to LiveTripsClient)
# --------------------------------------------------------------------
$pagePath = Join-Path $livetripsDir "page.tsx"
Backup-File $pagePath

@'
import { getLiveTrips } from "./actions/getLiveTrips";
import LiveTripsClient from "./LiveTripsClient";

export const dynamic = "force-dynamic";

export default async function LiveTripsPage() {
  const trips = await getLiveTrips();

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      <LiveTripsClient initialTrips={trips} />
    </div>
  );
}
'@ | Out-File -FilePath $pagePath -Encoding utf8
Write-Host "✅ Wrote $pagePath"

# --------------------------------------------------------------------
# 2) actions/getLiveTrips.ts  (maps Supabase RPC -> clean objects)
# --------------------------------------------------------------------
$actionsPath = Join-Path $actionsDir "getLiveTrips.ts"
Backup-File $actionsPath

@'
import { createClient } from "@/utils/supabase/server";

export type LatLng = {
  lat: number;
  lng: number;
};

export type LiveTrip = {
  id: number;
  booking_code: string;
  passenger_name: string | null;
  zone: string | null;
  status: string;
  pickup: LatLng | null;
  dropoff: LatLng | null;
};

export async function getLiveTrips(): Promise<LiveTrip[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("admin_get_live_trips_page_data");

  if (error) {
    console.error("admin_get_live_trips_page_data error", error);
    throw error;
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((b: any) => {
    const pickup =
      b.pickup_lat != null && b.pickup_lng != null
        ? { lat: Number(b.pickup_lat), lng: Number(b.pickup_lng) }
        : null;

    const dropoff =
      b.dropoff_lat != null && b.dropoff_lng != null
        ? { lat: Number(b.dropoff_lat), lng: Number(b.dropoff_lng) }
        : null;

    return {
      id: Number(b.id),
      booking_code: String(b.booking_code),
      passenger_name: b.passenger_name ?? null,
      zone: (b.zone ?? b.town ?? null) as string | null,
      status: String(b.status),
      pickup,
      dropoff,
    };
  });
}
'@ | Out-File -FilePath $actionsPath -Encoding utf8
Write-Host "✅ Wrote $actionsPath"

# --------------------------------------------------------------------
# 3) LiveTripsClient.tsx  (client component – rows + selected booking)
# --------------------------------------------------------------------
$clientPath = Join-Path $livetripsDir "LiveTripsClient.tsx"
Backup-File $clientPath

@'
"use client";

import { useMemo, useState } from "react";
import type { LiveTrip } from "./actions/getLiveTrips";
import SelectedBookingPanel from "./components/SelectedBookingPanel";

type Props = {
  initialTrips: LiveTrip[];
};

export default function LiveTripsClient({ initialTrips }: Props) {
  const [trips] = useState<LiveTrip[]>(() => initialTrips ?? []);
  const [selectedBooking, setSelectedBooking] = useState<LiveTrip | null>(() =>
    initialTrips && initialTrips.length > 0 ? initialTrips[0] : null
  );

  const activeCount = useMemo(
    () => trips.filter((t) => t.status === "on_trip" || t.status === "on_the_way").length,
    [trips]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Top summary row */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs">
        <div className="font-semibold text-slate-700">
          Live Trips (Dispatch)
        </div>
        <div className="flex gap-2 text-slate-500">
          <div>Active trips: <span className="font-semibold text-slate-700">{activeCount}</span></div>
          <div>Total: <span className="font-semibold text-slate-700">{trips.length}</span></div>
        </div>
      </div>

      {/* Main content: table + selected booking */}
      <div className="flex min-h-0 flex-1">
        {/* Left: table */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-slate-200">
          <div className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold text-slate-500">
            ACTIVE &amp; RECENT TRIPS
          </div>
          <div className="flex-1 overflow-auto">
            <table className="min-w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 bg-white text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2 text-left">Code</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left">Passenger</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left">Pickup</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left">Dropoff</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left">Zone</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="text-[11px] text-slate-700">
                {trips.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-4 text-center text-slate-400"
                    >
                      No active trips.
                    </td>
                  </tr>
                )}

                {trips.map((trip) => {
                  const isSelected = selectedBooking?.id === trip.id;
                  return (
                    <tr
                      key={trip.id}
                      onClick={() => setSelectedBooking(trip)}
                      className={
                        "cursor-pointer transition-colors " +
                        (isSelected
                          ? "bg-sky-50 hover:bg-sky-100"
                          : "hover:bg-slate-50")
                      }
                    >
                      <td className="border-b border-slate-100 px-3 py-2">
                        <span className="font-semibold">{trip.booking_code}</span>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {trip.passenger_name ?? "—"}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {trip.pickup ? `${trip.pickup.lat.toFixed(4)}, ${trip.pickup.lng.toFixed(4)}` : "—"}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {trip.dropoff ? `${trip.dropoff.lat.toFixed(4)}, ${trip.dropoff.lng.toFixed(4)}` : "—"}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {trip.zone ?? "—"}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        <span className="rounded-full border px-2 py-[2px] text-[10px] uppercase">
                          {trip.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: selected booking + map */}
        <div className="flex min-w-[420px] max-w-[640px] flex-1 flex-col">
          <SelectedBookingPanel booking={selectedBooking} />
        </div>
      </div>
    </div>
  );
}
'@ | Out-File -FilePath $clientPath -Encoding utf8
Write-Host "✅ Wrote $clientPath"

# --------------------------------------------------------------------
# 4) components/SelectedBookingPanel.tsx
# --------------------------------------------------------------------
$selectedPath = Join-Path $componentsDir "SelectedBookingPanel.tsx"
Backup-File $selectedPath

@'
"use client";

import type { LiveTrip } from "../actions/getLiveTrips";
import LiveTripMapClient from "../map/LiveTripMapClient";

type Props = {
  booking: LiveTrip | null;
};

export default function SelectedBookingPanel({ booking }: Props) {
  if (!booking) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        Select a booking to inspect details and follow the trip on the map.
      </div>
    );
  }

  const { booking_code, passenger_name, pickup, dropoff } = booking;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs">
        <div className="font-semibold text-slate-700">{booking_code}</div>
        <div className="text-slate-500">
          {passenger_name ?? "No passenger name"}
        </div>
      </div>

      <div className="flex-1 min-h-[320px]">
        <LiveTripMapClient
          pickup={pickup ?? undefined}
          dropoff={dropoff ?? undefined}
        />
      </div>
    </div>
  );
}
'@ | Out-File -FilePath $selectedPath -Encoding utf8
Write-Host "✅ Wrote $selectedPath"

# --------------------------------------------------------------------
# 5) map/LiveTripMapClient.tsx  (Mapbox – markers + route)
# --------------------------------------------------------------------
$mapPath = Join-Path $mapDir "LiveTripMapClient.tsx"
Backup-File $mapPath

@'
"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type LatLng = {
  lat: number;
  lng: number;
};

type Props = {
  pickup?: LatLng;
  dropoff?: LatLng;
};

mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
  "";

export default function LiveTripMapClient({ pickup, dropoff }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapboxgl.accessToken) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_TOKEN");
      return;
    }

    if (!mapRef.current) {
      mapRef.current = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [121.094, 16.815],
        zoom: 13,
      });
    }

    const map = mapRef.current;

    if (!map.isStyleLoaded()) {
      const onLoad = () => {
        map.off("load", onLoad);
        updateMap(map);
      };
      map.on("load", onLoad);
    } else {
      updateMap(map);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  const updateMap = (map: mapboxgl.Map) => {
    // Clear markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Clear existing route
    if (map.getSource("livetrip-route")) {
      if (map.getLayer("livetrip-route")) {
        map.removeLayer("livetrip-route");
      }
      map.removeSource("livetrip-route");
    }

    const points: [number, number][] = [];

    if (pickup) {
      const m = new mapboxgl.Marker({ color: "#22c55e" }) // green
        .setLngLat([pickup.lng, pickup.lat])
        .addTo(map);
      markersRef.current.push(m);
      points.push([pickup.lng, pickup.lat]);
    }

    if (dropoff) {
      const m = new mapboxgl.Marker({ color: "#ef4444" }) // red
        .setLngLat([dropoff.lng, dropoff.lat])
        .addTo(map);
      markersRef.current.push(m);
      points.push([dropoff.lng, dropoff.lat]);
    }

    if (pickup && dropoff) {
      const routeGeoJson: any = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [pickup.lng, pickup.lat],
            [dropoff.lng, dropoff.lat],
          ],
        },
        properties: {},
      };

      map.addSource("livetrip-route", {
        type: "geojson",
        data: routeGeoJson,
      });

      map.addLayer({
        id: "livetrip-route",
        type: "line",
        source: "livetrip-route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 4,
        },
      });
    }

    if (points.length > 0) {
      const bounds = points.reduce(
        (b, coord) => b.extend(coord),
        new mapboxgl.LngLatBounds(points[0], points[0])
      );
      map.fitBounds(bounds, { padding: 60, maxZoom: 17 });
    }
  };

  return (
    <div className="h-full w-full">
      <div
        ref={mapContainerRef}
        className="h-full w-full overflow-hidden rounded-xl"
      />
    </div>
  );
}
'@ | Out-File -FilePath $mapPath -Encoding utf8
Write-Host "✅ Wrote $mapPath"

Write-Host ""
Write-Host "🎉 fix-livetrips-full.ps1 completed. Restart dev server and test /admin/livetrips."
