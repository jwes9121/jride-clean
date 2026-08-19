"use client";

import * as React from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useParams } from "next/navigation";

mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

type Coordinate = [number, number];

type RouteResponse = {
  success: boolean;
  event?: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
  route?: {
    routeName: string;
    officialDistanceKm: number | null;
    measuredDistanceKm: number;
    coordinates: Coordinate[];
    routeVersion: number;
    updatedAt: string;
  } | null;
  error?: string;
};

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function segmentDistanceKm(a: Coordinate, b: Coordinate) {
  const earthRadiusKm = 6371.0088;
  const dLat = radians(b[1] - a[1]);
  const dLng = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) ** 2;

  return (
    2 *
    earthRadiusKm *
    Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  );
}

function measuredDistanceKm(coordinates: Coordinate[]) {
  let total = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    total += segmentDistanceKm(
      coordinates[index - 1],
      coordinates[index]
    );
  }

  return Math.round(total * 1000) / 1000;
}

function lineData(coordinates: Coordinate[]) {
  return {
    type: "FeatureCollection",
    features:
      coordinates.length >= 2
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates,
              },
            },
          ]
        : [],
  };
}

function pointData(coordinates: Coordinate[]) {
  return {
    type: "FeatureCollection",
    features: coordinates.map((coordinate, index) => ({
      type: "Feature",
      properties: {
        sequence: index + 1,
      },
      geometry: {
        type: "Point",
        coordinates: coordinate,
      },
    })),
  };
}

function normalizeImportedCoordinates(
  value: unknown
): Coordinate[] | null {
  let raw: unknown = value;

  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw)
  ) {
    const candidate = raw as any;

    if (
      candidate.type === "Feature" &&
      candidate.geometry?.type === "LineString"
    ) {
      raw = candidate.geometry.coordinates;
    } else if (
      candidate.type === "LineString"
    ) {
      raw = candidate.coordinates;
    }
  }

  if (!Array.isArray(raw)) return null;

  const coordinates: Coordinate[] = [];

  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) {
      return null;
    }

    const longitude = Number(item[0]);
    const latitude = Number(item[1]);

    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      return null;
    }

    coordinates.push([longitude, latitude]);
  }

  return coordinates.length >= 2 ? coordinates : null;
}

export default function EventCourseRouteEditorPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [routeName, setRouteName] = React.useState(
    "Fun Walk and Taebo Official Route"
  );
  const [officialDistanceKm, setOfficialDistanceKm] =
    React.useState("5.21");
  const [coordinates, setCoordinates] =
    React.useState<Coordinate[]>([]);
  const [importText, setImportText] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  const mapContainerRef =
    React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<mapboxgl.Map | null>(null);
  const initialFitRef = React.useRef(false);

  const measured = React.useMemo(
    () => measuredDistanceKm(coordinates),
    [coordinates]
  );

  React.useEffect(() => {
    if (!eventSlug) return;

    let cancelled = false;

    async function loadRoute() {
      try {
        const response = await fetch(
          `/api/events/${encodeURIComponent(
            eventSlug
          )}/course-route`,
          {
            cache: "no-store",
          }
        );

        const payload = (await response.json()) as RouteResponse;

        if (!response.ok || !payload.success) {
          throw new Error(
            payload.error || "Unable to load course route."
          );
        }

        if (cancelled) return;

        if (payload.route) {
          setRouteName(payload.route.routeName);
          setOfficialDistanceKm(
            payload.route.officialDistanceKm == null
              ? ""
              : String(payload.route.officialDistanceKm)
          );
          setCoordinates(payload.route.coordinates);
        }

        setLoaded(true);
      } catch (caught) {
        if (cancelled) return;

        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load course route."
        );
        setLoaded(true);
      }
    }

    void loadRoute();

    return () => {
      cancelled = true;
    };
  }, [eventSlug]);

  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    if (!mapboxgl.accessToken) {
      setError(
        "NEXT_PUBLIC_MAPBOX_TOKEN is missing. The route editor cannot load."
      );
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [121.1, 16.8],
      zoom: 13,
    });

    map.addControl(
      new mapboxgl.NavigationControl(),
      "top-right"
    );

    map.on("load", () => {
      map.addSource("course-draft-line", {
        type: "geojson",
        data: lineData([]) as any,
      });

      map.addLayer({
        id: "course-draft-halo",
        type: "line",
        source: "course-draft-line",
        paint: {
          "line-color": "#ffffff",
          "line-width": 9,
          "line-opacity": 0.95,
        },
      });

      map.addLayer({
        id: "course-draft-line",
        type: "line",
        source: "course-draft-line",
        paint: {
          "line-color": "#2563eb",
          "line-width": 5,
          "line-opacity": 1,
        },
      });

      map.addSource("course-draft-points", {
        type: "geojson",
        data: pointData([]) as any,
      });

      map.addLayer({
        id: "course-draft-points",
        type: "circle",
        source: "course-draft-points",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#1d4ed8",
          "circle-stroke-width": 3,
        },
      });
    });

    map.on("click", (event) => {
      setCoordinates((current) => [
        ...current,
        [
          Math.round(event.lngLat.lng * 1e7) / 1e7,
          Math.round(event.lngLat.lat * 1e7) / 1e7,
        ],
      ]);
    });

    mapRef.current = map;

    navigator.geolocation?.getCurrentPosition(
      (position) => {
        if (initialFitRef.current) return;

        map.easeTo({
          center: [
            position.coords.longitude,
            position.coords.latitude,
          ],
          zoom: 15,
        });
      },
      () => {},
      {
        enableHighAccuracy: true,
        timeout: 5000,
      }
    );

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;

    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const lineSource = map.getSource(
      "course-draft-line"
    ) as mapboxgl.GeoJSONSource | undefined;
    const pointSource = map.getSource(
      "course-draft-points"
    ) as mapboxgl.GeoJSONSource | undefined;

    lineSource?.setData(lineData(coordinates) as any);
    pointSource?.setData(pointData(coordinates) as any);

    if (
      !initialFitRef.current &&
      coordinates.length >= 2
    ) {
      const bounds = new mapboxgl.LngLatBounds();

      for (const coordinate of coordinates) {
        bounds.extend(coordinate);
      }

      map.fitBounds(bounds, {
        padding: 70,
        maxZoom: 17,
        duration: 0,
      });

      initialFitRef.current = true;
    }
  }, [coordinates, loaded]);

  async function saveRoute() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(
          eventSlug
        )}/course-route`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            routeName,
            officialDistanceKm,
            coordinates,
          }),
        }
      );

      const payload = (await response.json()) as RouteResponse;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error || "Unable to save course route."
        );
      }

      setMessage(
        `Official course saved. Version ${
          payload.route?.routeVersion || "-"
        }.`
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save course route."
      );
    } finally {
      setSaving(false);
    }
  }

  function importRoute() {
    setError("");
    setMessage("");

    try {
      const parsed = JSON.parse(importText);
      const imported =
        normalizeImportedCoordinates(parsed);

      if (!imported) {
        throw new Error(
          "Paste a GeoJSON LineString, GeoJSON Feature, or coordinate array."
        );
      }

      setCoordinates(imported);
      initialFitRef.current = false;
      setMessage(
        `${imported.length} course points imported.`
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to import course route."
      );
    }
  }

  async function copyGeoJson() {
    const geojson = JSON.stringify(
      {
        type: "Feature",
        properties: {
          routeName,
          officialDistanceKm:
            officialDistanceKm || null,
        },
        geometry: {
          type: "LineString",
          coordinates,
        },
      },
      null,
      2
    );

    try {
      await navigator.clipboard.writeText(geojson);
      setMessage("Course GeoJSON copied.");
    } catch {
      setImportText(geojson);
      setMessage(
        "Course GeoJSON placed in the import/export box."
      );
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-4 py-4">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
              JRide Events - Course Control
            </p>
            <h1 className="mt-1 text-3xl font-black">
              Official Course Editor
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Click along the exact Google-planned route. The saved blue line does not depend on Mapbox road connectivity.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/events/${eventSlug}/course`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-black"
            >
              Preview Public Course
            </a>
            <button
              type="button"
              onClick={() => window.close()}
              className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-black"
            >
              Close Editor
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1600px] gap-4 p-4 xl:grid-cols-[390px_1fr]">
        <aside className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
              Route Name
            </span>
            <input
              value={routeName}
              onChange={(event) =>
                setRouteName(event.target.value)
              }
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
              Official Advertised Distance (km)
            </span>
            <input
              value={officialDistanceKm}
              onChange={(event) =>
                setOfficialDistanceKm(event.target.value)
              }
              inputMode="decimal"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
            />
          </label>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Metric
              label="Points"
              value={coordinates.length}
            />
            <Metric
              label="Measured"
              value={`${measured.toFixed(3)} km`}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-cyan-800 bg-cyan-950/30 p-4 text-sm leading-6 text-cyan-100">
            Use the Google route screenshot beside this editor. Click each turn, including the new bridge and roads that are missing from the Mapbox road layer. The saved custom line will still connect those points.
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                setCoordinates((current) =>
                  current.slice(0, -1)
                )
              }
              disabled={coordinates.length === 0}
              className="rounded-xl border border-slate-600 px-4 py-3 text-sm font-black disabled:opacity-40"
            >
              Undo Point
            </button>
            <button
              type="button"
              onClick={() => {
                setCoordinates([]);
                initialFitRef.current = false;
              }}
              disabled={coordinates.length === 0}
              className="rounded-xl border border-red-700 px-4 py-3 text-sm font-black text-red-300 disabled:opacity-40"
            >
              Clear Route
            </button>
          </div>

          <button
            type="button"
            onClick={() => void saveRoute()}
            disabled={
              saving ||
              coordinates.length < 2 ||
              routeName.trim().length < 3
            }
            className="mt-3 w-full rounded-xl bg-cyan-400 px-4 py-4 font-black text-slate-950 disabled:opacity-40"
          >
            {saving
              ? "Saving..."
              : "Save Official Course"}
          </button>

          {message ? (
            <p className="mt-3 rounded-xl bg-emerald-950/50 px-3 py-2 text-sm font-bold text-emerald-200">
              {message}
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-xl bg-red-950/50 px-3 py-2 text-sm font-bold text-red-200">
              {error}
            </p>
          ) : null}

          <details className="mt-5 rounded-2xl border border-slate-700 p-4">
            <summary className="cursor-pointer font-black">
              Import / Export GeoJSON
            </summary>
            <textarea
              value={importText}
              onChange={(event) =>
                setImportText(event.target.value)
              }
              placeholder="Paste a GeoJSON LineString, Feature, or [[lng,lat], ...] array."
              className="mt-3 min-h-40 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs"
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={importRoute}
                className="rounded-xl border border-cyan-600 px-3 py-3 text-sm font-black text-cyan-200"
              >
                Import
              </button>
              <button
                type="button"
                onClick={() => void copyGeoJson()}
                className="rounded-xl border border-slate-600 px-3 py-3 text-sm font-black"
              >
                Copy GeoJSON
              </button>
            </div>
          </details>
        </aside>

        <div className="relative min-h-[760px] overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
          <div
            ref={mapContainerRef}
            className="absolute inset-0"
          />
          {!loaded ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 font-black">
              Loading course editor...
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl bg-slate-950 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-black">
        {value}
      </p>
    </div>
  );
}