"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// TODO: change to your real table name if different
const DRIVER_TABLE = "live_driver_locations";

type Status = "init" | "no_container" | "missing_token" | "ok" | "error";

type DriverRow = {
  id: string;
  driver_id?: string | null;
  lat: number;
  lng: number;
  status?: string | null;
  updated_at?: string | null;
};

function toFeatureCollection(drivers: DriverRow[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: drivers
      .filter(
        (d) =>
          typeof d.lat === "number" &&
          !Number.isNaN(d.lat) &&
          typeof d.lng === "number" &&
          !Number.isNaN(d.lng)
      )
      .map((d) => ({
        type: "Feature",
        properties: {
          id: d.id,
          driverId: d.driver_id ?? d.id,
          status: d.status ?? "unknown",
          updated_at: d.updated_at ?? null
        },
        geometry: {
          type: "Point",
          coordinates: [d.lng, d.lat]
        }
      }))
  };
}

function createSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn(
      "[LiveDriverMap] Supabase env vars missing; realtime driver updates disabled."
    );
    return null;
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 5 } }
  });
}

export default function LiveDriverMap() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<Status>("init");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    console.log("[LiveDriverMap] useEffect started");

    if (typeof window === "undefined") {
      console.log("[LiveDriverMap] Running on server, abort init");
      return;
    }

    const container = mapContainerRef.current;
    if (!container) {
      console.error("[LiveDriverMap] No container element");
      setStatus("no_container");
      setErrorMessage("Map container not found.");
      return;
    }

    if (!MAPBOX_TOKEN) {
      console.error(
        "[LiveDriverMap] Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN (check Vercel env)."
      );
      setStatus("missing_token");
      setErrorMessage(
        "Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN. Set it in Vercel → Project Settings → Environment Variables."
      );
      return;
    }

    let destroyed = false;

    (async () => {
      try {
        const mapboxglModule = await import("mapbox-gl");
        const mapboxgl: any =
          (mapboxglModule as any).default || (mapboxglModule as any);

        mapboxgl.accessToken = MAPBOX_TOKEN;

        console.log("[LiveDriverMap] Creating map instance");

        const map: any = new mapboxgl.Map({
          container,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [121.1, 16.8], // adjust for your ops area
          zoom: 9
        });

        mapRef.current = map;

        map.addControl(
          new mapboxgl.NavigationControl({ visualizePitch: true }),
          "top-right"
        );

        map.on("load", async () => {
          if (destroyed) return;
          console.log("[LiveDriverMap] Map loaded, adding sources/layers");

          map.addSource("drivers", {
            type: "geojson",
            data: toFeatureCollection([]),
            cluster: true,
            clusterRadius: 40,
            clusterMaxZoom: 16
          });

          // clustered bubbles
          map.addLayer({
            id: "driver-clusters",
            type: "circle",
            source: "drivers",
            filter: ["has", "point_count"],
            paint: {
              "circle-radius": [
                "step",
                ["get", "point_count"],
                14,
                20,
                18,
                50,
                24
              ],
              "circle-color": [
                "step",
                ["get", "point_count"],
                "#3B82F6",
                20,
                "#22C55E",
                50,
                "#EF4444"
              ],
              "circle-opacity": 0.9
            }
          });

          // cluster counts
          map.addLayer({
            id: "driver-cluster-count",
            type: "symbol",
            source: "drivers",
            filter: ["has", "point_count"],
            layout: {
              "text-field": ["get", "point_count_abbreviated"],
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-size": 12
            },
            paint: {
              "text-color": "#ffffff"
            }
          });

          // individual drivers
          map.addLayer({
            id: "driver-points",
            type: "circle",
            source: "drivers",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": 6,
              "circle-color": [
                "match",
                ["get", "status"],
                "online",
                "#22C55E",
                "on-trip",
                "#3B82F6",
                "offline",
                "#9CA3AF",
                "#F97316" // default
              ],
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#ffffff"
            }
          });

          // click cluster to zoom
          map.on("click", "driver-clusters", (e: any) => {
            const features = map.queryRenderedFeatures(e.point, {
              layers: ["driver-clusters"]
            });
            const clusterId = features[0]?.properties?.cluster_id;
            const src = map.getSource("drivers") as any;
            if (!clusterId || !src) return;
            src.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
              if (err || zoom == null) return;
              map.easeTo({
                center: (features[0].geometry as any).coordinates,
                zoom
              });
            });
          });

          map.on("mouseenter", "driver-clusters", () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "driver-clusters", () => {
            map.getCanvas().style.cursor = "";
          });

          // Supabase: initial + realtime (only if env is configured)
          const supabase = createSupabase();
          supabaseRef.current = supabase;

          if (supabase) {
            const src = map.getSource("drivers") as any;

            // initial load
            const { data, error } = await supabase
              .from(DRIVER_TABLE)
              .select("*")
              .order("updated_at", { ascending: false })
              .limit(1000);

            if (error) {
              console.error(
                "[LiveDriverMap] Failed to load initial drivers",
                error
              );
            } else if (!destroyed && src && data) {
              const fc = toFeatureCollection(data as any);
              src.setData(fc);
              console.log(
                `[LiveDriverMap] Initial drivers loaded: ${fc.features.length}`
              );
            }

            let cache: Record<string, DriverRow> = {};
            ((data as any[]) ?? []).forEach((d) => {
              if (d && d.id) cache[d.id] = d as any;
            });

            const update = () => {
              const source = map.getSource("drivers") as any;
              if (!source) return;
              source.setData(
                toFeatureCollection(Object.values(cache))
              );
            };

            const channel = supabase
              .channel("live-driver-map")
              .on(
                "postgres_changes",
                {
                  event: "*",
                  schema: "public",
                  table: DRIVER_TABLE
                },
                (payload: any) => {
                  if (payload.eventType === "DELETE") {
                    const id = payload.old?.id;
                    if (id) delete cache[id];
                  } else {
                    const row = payload.new as DriverRow;
                    if (
                      row &&
                      typeof row.lat === "number" &&
                      typeof row.lng === "number"
                    ) {
                      cache[row.id] = row;
                    }
                  }
                  if (!destroyed) update();
                }
              )
              .subscribe((status: string) => {
                console.log(
                  "[LiveDriverMap] Realtime channel status:",
                  status
                );
              });

            unsubscribeRef.current = () => {
              supabase.removeChannel(channel);
            };
          }

          setStatus("ok");
          console.log("[LiveDriverMap] Map fully initialised");
        });

        map.on("error", (event: any) => {
          if (destroyed) return;
          console.error("[LiveDriverMap] Map error:", event?.error || event);
          setStatus("error");
          setErrorMessage(
            "Mapbox reported an error. Check console for full details."
          );
        });
      } catch (err: any) {
        if (destroyed) return;
        console.error("[LiveDriverMap] Init failed:", err);
        setStatus("error");
        setErrorMessage(
          "Failed to initialize Mapbox. See console for error details."
        );
      }
    })();

    return () => {
      destroyed = true;
      console.log("[LiveDriverMap] Cleaning up map and realtime");
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full h-[70vh]">
      <div ref={mapContainerRef} className="w-full h-full" />
      {status !== "ok" && (
        <div className="absolute inset-0 flex items-start justify-start p-2 text-xs text-red-600 pointer-events-none">
          {status === "init" && "Initializing map..."}
          {status === "no_container" && errorMessage}
          {status === "missing_token" && errorMessage}
          {status === "error" && errorMessage}
        </div>
      )}
    </div>
  );
}
