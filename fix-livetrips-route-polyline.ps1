# fix-livetrips-route-polyline.ps1
# Rewrites LiveTripMapClient.tsx so that the blue polyline uses
# Mapbox Directions (driving) and follows the road instead of a straight line.

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$mapDir = Join-Path $root "app\admin\livetrips\map"
$mapPath = Join-Path $mapDir "LiveTripMapClient.tsx"

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

New-Item -ItemType Directory -Force -Path $mapDir | Out-Null
Backup-File $mapPath

@'
"use client";

import { useEffect, useRef, useState } from "react";
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

type RouteState = {
  coordinates: [number, number][];
} | null;

export default function LiveTripMapClient({ pickup, dropoff }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [route, setRoute] = useState<RouteState>(null);

  // 1) Fetch driving route from Mapbox Directions whenever pickup/dropoff change
  useEffect(() => {
    if (!pickup || !dropoff) {
      setRoute(null);
      return;
    }

    if (!mapboxgl.accessToken) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_TOKEN / NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
      return;
    }

    const controller = new AbortController();

    const fetchRoute = async () => {
      try {
        const url = new URL(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`
        );
        url.searchParams.set("geometries", "geojson");
        url.searchParams.set("overview", "full");
        url.searchParams.set("access_token", mapboxgl.accessToken);

        const res = await fetch(url.toString(), { signal: controller.signal });
        if (!res.ok) {
          console.error("Directions API error", await res.text());
          return;
        }

        const json = await res.json();
        const firstRoute = json.routes && json.routes[0];
        if (!firstRoute || !firstRoute.geometry || !Array.isArray(firstRoute.geometry.coordinates)) {
          console.warn("No route geometry in Directions response", json);
          return;
        }

        const coords: [number, number][] = firstRoute.geometry.coordinates;
        setRoute({ coordinates: coords });
      } catch (err: any) {
        if (err.name === "AbortError") return;
        console.error("Error fetching directions", err);
      }
    };

    fetchRoute();

    return () => {
      controller.abort();
    };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // 2) Initialize map and render markers + route
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapboxgl.accessToken) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_TOKEN / NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
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
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, route?.coordinates]);

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

    // Pickup marker (green)
    if (pickup) {
      const pickupMarker = new mapboxgl.Marker({ color: "#22c55e" })
        .setLngLat([pickup.lng, pickup.lat])
        .addTo(map);
      markersRef.current.push(pickupMarker);
      points.push([pickup.lng, pickup.lat]);
    }

    // Dropoff marker (red)
    if (dropoff) {
      const dropoffMarker = new mapboxgl.Marker({ color: "#ef4444" })
        .setLngLat([dropoff.lng, dropoff.lat])
        .addTo(map);
      markersRef.current.push(dropoffMarker);
      points.push([dropoff.lng, dropoff.lat]);
    }

    // Route polyline using Directions geometry if available
    if (route && route.coordinates && route.coordinates.length > 1) {
      const routeGeoJson: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: route.coordinates,
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

      // Use the route coordinates for bounds
      const bounds = route.coordinates.reduce(
        (b, coord) => b.extend(coord as [number, number]),
        new mapboxgl.LngLatBounds(
          route.coordinates[0],
          route.coordinates[0]
        )
      );
      map.fitBounds(bounds, { padding: 60, maxZoom: 17 });
      return;
    }

    // Fallback: fit to markers only if no route yet
    if (points.length > 0) {
      const bounds = points.reduce(
        (b, coord) => b.extend(coord as [number, number]),
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

Write-Host "✅ Rewrote $mapPath with Directions-based polyline."
