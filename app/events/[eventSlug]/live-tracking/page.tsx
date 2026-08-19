"use client";

import * as React from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useParams } from "next/navigation";

mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

type Coordinate = [number, number];

type PositionRow = {
  attendeeId: string;
  fullName: string;
  registrationNumber: string;
  groupValue: string | null;
  attendanceStatus: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  headingDeg: number | null;
  speedMps: number | null;
  sharingStartedAt: string;
  updatedAt: string;
  ageSeconds: number | null;
  freshness: "fresh" | "delayed" | "stale";
};

type CourseRoute = {
  routeName: string;
  officialDistanceKm: number | null;
  measuredDistanceKm: number;
  coordinates: Coordinate[];
  routeVersion: number;
  updatedAt: string;
};

type LiveTrackingResponse = {
  success: boolean;
  trackingOpen?: boolean;
  generatedAt?: string;
  event?: {
    id: string;
    slug: string;
    name: string;
    event_date: string | null;
    status: string;
  };
  summary?: {
    checkedIn: number;
    sharing: number;
    fresh: number;
    delayed: number;
    stale: number;
  };
  positions?: PositionRow[];
  message?: string;
  error?: string;
};

type RouteResponse = {
  success: boolean;
  route?: CourseRoute | null;
  error?: string;
};

function relativeAge(seconds: number | null) {
  if (seconds === null) return "unknown";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function markerColor(
  freshness: PositionRow["freshness"]
) {
  if (freshness === "fresh") return "#10b981";
  if (freshness === "delayed") return "#f59e0b";
  return "#ef4444";
}

function popupNode(position: PositionRow) {
  const root = document.createElement("div");
  root.style.minWidth = "210px";

  const name = document.createElement("div");
  name.textContent = position.fullName;
  name.style.fontWeight = "800";
  name.style.fontSize = "15px";
  root.appendChild(name);

  const pass = document.createElement("div");
  pass.textContent = position.registrationNumber;
  pass.style.marginTop = "4px";
  pass.style.fontFamily = "monospace";
  pass.style.fontSize = "12px";
  root.appendChild(pass);

  const status = document.createElement("div");
  status.textContent =
    `Location ${relativeAge(
      position.ageSeconds
    )} | ` +
    (
      position.accuracyM == null
        ? "accuracy unknown"
        : `about ${Math.round(
            position.accuracyM
          )} m accuracy`
    );
  status.style.marginTop = "6px";
  status.style.fontSize = "12px";
  root.appendChild(status);

  return root;
}

function courseFeature(coordinates: Coordinate[]) {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates,
    },
  };
}

function syncCourseLayer(
  map: mapboxgl.Map,
  route: CourseRoute | null
) {
  const coordinates = route?.coordinates || [];

  if (coordinates.length < 2) {
    return;
  }

  const source = map.getSource(
    "official-course"
  ) as mapboxgl.GeoJSONSource | undefined;

  if (source) {
    source.setData(courseFeature(coordinates) as any);
    return;
  }

  map.addSource("official-course", {
    type: "geojson",
    data: courseFeature(coordinates) as any,
  });

  map.addLayer({
    id: "official-course-halo",
    type: "line",
    source: "official-course",
    paint: {
      "line-color": "#ffffff",
      "line-width": 10,
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "official-course-line",
    type: "line",
    source: "official-course",
    paint: {
      "line-color": "#2563eb",
      "line-width": 6,
      "line-opacity": 1,
    },
  });
}

export default function EventLiveTrackingPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [data, setData] =
    React.useState<LiveTrackingResponse | null>(
      null
    );
  const [courseRoute, setCourseRoute] =
    React.useState<CourseRoute | null>(null);
  const [error, setError] = React.useState("");
  const [refreshing, setRefreshing] =
    React.useState(false);

  const mapContainerRef =
    React.useRef<HTMLDivElement | null>(null);
  const mapRef =
    React.useRef<mapboxgl.Map | null>(null);
  const markersRef =
    React.useRef<Map<string, mapboxgl.Marker>>(
      new Map()
    );
  const fittedRef = React.useRef(false);

  async function load(background = false) {
    if (background) setRefreshing(true);
    setError("");

    try {
      const [trackingResponse, routeResponse] =
        await Promise.all([
          fetch(
            `/api/events/${encodeURIComponent(
              eventSlug
            )}/live-location/admin`,
            {
              cache: "no-store",
            }
          ),
          fetch(
            `/api/events/${encodeURIComponent(
              eventSlug
            )}/course-route`,
            {
              cache: "no-store",
            }
          ),
        ]);

      const trackingPayload =
        (await trackingResponse.json()) as LiveTrackingResponse;
      const routePayload =
        (await routeResponse.json()) as RouteResponse;

      if (
        !trackingResponse.ok ||
        !trackingPayload.success
      ) {
        throw new Error(
          trackingPayload.error ||
            "Unable to load live safety tracking."
        );
      }

      setData(trackingPayload);

      if (
        routeResponse.ok &&
        routePayload.success
      ) {
        setCourseRoute(routePayload.route || null);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load live safety tracking."
      );
    } finally {
      setRefreshing(false);
    }
  }

  React.useEffect(() => {
    if (!eventSlug) return;

    void load(false);

    const timer = window.setInterval(() => {
      void load(true);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [eventSlug]);

  const positions = data?.positions || [];
  const routeCoordinates =
    courseRoute?.coordinates || [];

  React.useEffect(() => {
    const hasMapData =
      positions.length > 0 ||
      routeCoordinates.length >= 2;

    if (
      !mapContainerRef.current ||
      !hasMapData
    ) {
      return;
    }

    if (!mapboxgl.accessToken) {
      setError(
        "NEXT_PUBLIC_MAPBOX_TOKEN is missing. Live positions are listed below but the map cannot load."
      );
      return;
    }

    if (!mapRef.current) {
      const center: Coordinate =
        routeCoordinates[0] ||
        [
          positions[0].longitude,
          positions[0].latitude,
        ];

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style:
          "mapbox://styles/mapbox/satellite-streets-v12",
        center,
        zoom: 15,
      });

      map.addControl(
        new mapboxgl.NavigationControl(),
        "top-right"
      );

      mapRef.current = map;
    }

    const activeMap = mapRef.current;

    if (!activeMap) return;

    const sync = () => {
      syncCourseLayer(
        activeMap,
        courseRoute
      );

      const activeIds = new Set(
        positions.map(
          (position) => position.attendeeId
        )
      );

      for (
        const [attendeeId, marker]
        of markersRef.current.entries()
      ) {
        if (!activeIds.has(attendeeId)) {
          marker.remove();
          markersRef.current.delete(attendeeId);
        }
      }

      for (const position of positions) {
        let marker = markersRef.current.get(
          position.attendeeId
        );

        if (!marker) {
          const element =
            document.createElement("button");
          element.type = "button";
          element.title = position.fullName;
          element.style.width = "24px";
          element.style.height = "24px";
          element.style.borderRadius = "999px";
          element.style.border =
            "3px solid white";
          element.style.boxShadow =
            "0 2px 8px rgba(0,0,0,0.35)";
          element.style.cursor = "pointer";

          const newMarker =
            new mapboxgl.Marker({ element })
              .setLngLat([
                position.longitude,
                position.latitude,
              ])
              .addTo(activeMap);

          markersRef.current.set(
            position.attendeeId,
            newMarker
          );
          marker = newMarker;
        }

        if (!marker) continue;

        const element = marker.getElement();
        element.style.backgroundColor =
          markerColor(position.freshness);
        element.title =
          `${position.fullName} - ` +
          relativeAge(position.ageSeconds);

        marker
          .setLngLat([
            position.longitude,
            position.latitude,
          ])
          .setPopup(
            new mapboxgl.Popup({
              offset: 18,
            }).setDOMContent(
              popupNode(position)
            )
          );
      }

      if (!fittedRef.current) {
        const bounds =
          new mapboxgl.LngLatBounds();

        for (
          const coordinate
          of routeCoordinates
        ) {
          bounds.extend(coordinate);
        }

        for (const position of positions) {
          bounds.extend([
            position.longitude,
            position.latitude,
          ]);
        }

        if (!bounds.isEmpty()) {
          activeMap.fitBounds(bounds, {
            padding: 70,
            maxZoom: 17,
            duration: 0,
          });
          fittedRef.current = true;
        }
      }
    };

    if (activeMap.isStyleLoaded()) {
      sync();
    } else {
      activeMap.once("load", sync);
    }
  }, [
    positions,
    routeCoordinates,
    courseRoute,
  ]);

  React.useEffect(() => {
    return () => {
      for (
        const marker
        of markersRef.current.values()
      ) {
        marker.remove();
      }
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  function focusAll() {
    if (!mapRef.current) return;

    const bounds =
      new mapboxgl.LngLatBounds();

    for (const coordinate of routeCoordinates) {
      bounds.extend(coordinate);
    }

    for (const position of positions) {
      bounds.extend([
        position.longitude,
        position.latitude,
      ]);
    }

    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, {
        padding: 70,
        maxZoom: 17,
      });
    }
  }

  const summary = data?.summary || {
    checkedIn: 0,
    sharing: 0,
    fresh: 0,
    delayed: 0,
    stale: 0,
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950 px-4 py-4">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
              JRide Events - Safety Operations
            </p>
            <h1 className="mt-1 text-3xl font-black">
              Live Safety Tracking
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {data?.event?.name || eventSlug}
            </p>
            {courseRoute ? (
              <p className="mt-1 text-xs font-bold text-cyan-300">
                Official course: {
                  courseRoute.routeName
                } | {
                  courseRoute.officialDistanceKm ??
                  courseRoute.measuredDistanceKm
                } km
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href={`/events/${eventSlug}/course`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-cyan-600 px-4 py-2 text-sm font-black text-cyan-200"
            >
              Public Course
            </a>
            <button
              type="button"
              onClick={focusAll}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-black"
            >
              Focus All
            </button>
            <button
              type="button"
              onClick={() => void load(false)}
              className="rounded-xl border border-emerald-600 px-4 py-2 text-sm font-black text-emerald-300"
            >
              {refreshing
                ? "Refreshing..."
                : "Refresh Now"}
            </button>
            <button
              type="button"
              onClick={() => window.close()}
              className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-black"
            >
              Close Window
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1600px] p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            label="Checked In"
            value={summary.checkedIn}
          />
          <Metric
            label="Sharing"
            value={summary.sharing}
          />
          <Metric
            label="Fresh <=45s"
            value={summary.fresh}
          />
          <Metric
            label="Delayed 46-120s"
            value={summary.delayed}
          />
          <Metric
            label="Stale >120s"
            value={summary.stale}
          />
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl bg-red-950/50 p-4 font-bold text-red-200">
            {error}
          </div>
        ) : null}

        {!data?.trackingOpen ? (
          <div className="mt-4 rounded-2xl border border-amber-700 bg-amber-950/40 p-5 text-amber-100">
            <p className="font-black">
              Tracking is not open yet.
            </p>
            <p className="mt-2 text-sm">
              {data?.message ||
                "Set the event status to LIVE when the Fun Walk starts."}
            </p>
          </div>
        ) : null}

        {!courseRoute ? (
          <div className="mt-4 rounded-2xl border border-cyan-800 bg-cyan-950/30 p-4 text-sm text-cyan-100">
            No official course has been saved yet. Use Event Admin Control - Live Operations - Edit Official Course before event day.
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
          <div className="relative min-h-[620px] overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
            <div
              ref={mapContainerRef}
              className="absolute inset-0"
            />

            {
              positions.length === 0 &&
              routeCoordinates.length < 2
            ? (
              <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
                <div>
                  <p className="text-2xl font-black">
                    Waiting for participant locations
                  </p>
                  <p className="mt-2 max-w-md text-sm text-slate-400">
                    A marker appears after a checked-in participant allows Safety Tracking from their Event Pass while the event is LIVE.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="max-h-[620px] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Last Known Locations
                </p>
                <h2 className="mt-1 text-xl font-black">
                  {positions.length} participant{
                    positions.length === 1
                      ? ""
                      : "s"
                  }
                </h2>
              </div>
              <span className="text-xs text-slate-500">
                Auto refresh 5s
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {positions.map((position) => (
                <button
                  key={position.attendeeId}
                  type="button"
                  onClick={() =>
                    mapRef.current?.flyTo({
                      center: [
                        position.longitude,
                        position.latitude,
                      ],
                      zoom: 17,
                    })
                  }
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950 p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black">
                        {position.fullName}
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-400">
                        {
                          position.registrationNumber
                        }
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                        position.freshness ===
                        "fresh"
                          ? "bg-emerald-900 text-emerald-200"
                          : position.freshness ===
                            "delayed"
                          ? "bg-amber-900 text-amber-200"
                          : "bg-red-900 text-red-200"
                      }`}
                    >
                      {position.freshness}
                    </span>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-300">
                    Updated {
                      relativeAge(
                        position.ageSeconds
                      )
                    }
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {
                      position.accuracyM == null
                        ? "GPS accuracy unknown"
                        : `GPS accuracy about ${Math.round(
                            position.accuracyM
                          )} m`
                    }
                  </p>
                </button>
              ))}
            </div>
          </aside>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-xs leading-5 text-slate-400">
          Safety note: the blue course line is organizer-controlled and does not depend on Mapbox road connectivity. Participant markers show each consenting participant's latest browser-reported location, not a stored route history. Browser updates may pause if the participant closes the Event Pass, locks the phone, loses mobile data, or the browser is put to sleep. Checkpoint scans remain the independent backup location record.
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
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black">
        {value}
      </p>
    </div>
  );
}