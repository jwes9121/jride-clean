"use client";

import * as React from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

type Coordinate = [number, number];
type MapMode = "course" | "satellite";

function mapStyle(mode: MapMode) {
  return mode === "satellite"
    ? "mapbox://styles/mapbox/satellite-streets-v12"
    : "mapbox://styles/mapbox/outdoors-v12";
}

function formatFinishTime(value: string | null) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

type CurrentPosition = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  updatedAt: string;
};

type Props = {
  eventSlug: string;
  eventName: string;
  registrationNumber: string;
  qrToken: string;
  tracking: boolean;
  currentPosition: CurrentPosition | null;
};

type PassProgressResponse = {
  success: boolean;
  runnerProgress?: {
    isComplete: boolean;
    timeline: {
      status: "passed" | "pending";
      passedAt: string | null;
    }[];
  } | null;
};

type RouteResponse = {
  success: boolean;
  route?: {
    routeName: string;
    officialDistanceKm: number | null;
    measuredDistanceKm: number;
    coordinates: Coordinate[];
  } | null;
  error?: string;
};

export default function EventParticipantLiveMap({
  eventSlug,
  eventName,
  registrationNumber,
  qrToken,
  tracking,
  currentPosition,
}: Props) {
  const [route, setRoute] =
    React.useState<RouteResponse["route"]>(null);
  const [expanded, setExpanded] =
    React.useState(false);
  const [shareMessage, setShareMessage] =
    React.useState("");
  const [error, setError] = React.useState("");
  const [mapMode, setMapMode] =
    React.useState<MapMode>("course");

  const mapContainerRef =
    React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<mapboxgl.Map | null>(
    null
  );
  const markerRef =
    React.useRef<mapboxgl.Marker | null>(null);
  const fittedRef = React.useRef(false);
  const appliedMapModeRef =
    React.useRef<MapMode | null>(null);

  React.useEffect(() => {
    if (!eventSlug) return;

    void fetch(
      `/api/events/${encodeURIComponent(
        eventSlug
      )}/course-route`,
      {
        cache: "no-store",
      }
    )
      .then(async (response) => {
        const payload =
          (await response.json()) as RouteResponse;

        if (!response.ok || !payload.success) {
          throw new Error(
            payload.error ||
              "Unable to load official course."
          );
        }

        setRoute(payload.route || null);
      })
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load official course."
        );
      });
  }, [eventSlug]);

  const coordinates = route?.coordinates || [];

  React.useEffect(() => {
    if (
      !expanded ||
      !mapContainerRef.current ||
      (
        coordinates.length < 2 &&
        !currentPosition
      )
    ) {
      return;
    }

    if (!mapboxgl.accessToken) {
      setError(
        "Your live map cannot load because the Mapbox token is missing."
      );
      return;
    }

    if (
      mapRef.current &&
      appliedMapModeRef.current !== mapMode
    ) {
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current.remove();
      mapRef.current = null;
      fittedRef.current = false;
    }

    if (!mapRef.current) {
      const center: Coordinate =
        currentPosition
          ? [
              currentPosition.longitude,
              currentPosition.latitude,
            ]
          : coordinates[0];

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: mapStyle(mapMode),
        center,
        zoom: 15,
      });

      map.addControl(
        new mapboxgl.NavigationControl(),
        "top-right"
      );

      map.on("load", () => {
        if (coordinates.length >= 2) {
          map.addSource("participant-course", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates,
              },
            } as any,
          });

          map.addLayer({
            id: "participant-course-halo",
            type: "line",
            source: "participant-course",
            paint: {
              "line-color": "#ffffff",
              "line-width": 9,
              "line-opacity": 0.95,
            },
          });

          map.addLayer({
            id: "participant-course-line",
            type: "line",
            source: "participant-course",
            paint: {
              "line-color": "#2563eb",
              "line-width": 5,
              "line-opacity": 1,
            },
          });
        }
      });

      mapRef.current = map;
      appliedMapModeRef.current = mapMode;
    }

    const map = mapRef.current;

    if (!map) return;

    if (
      map.isStyleLoaded() &&
      coordinates.length >= 2
    ) {
      const source = map.getSource(
        "participant-course"
      ) as mapboxgl.GeoJSONSource | undefined;

      source?.setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates,
        },
      } as any);
    }

    if (currentPosition) {
      const coordinate: Coordinate = [
        currentPosition.longitude,
        currentPosition.latitude,
      ];

      if (!markerRef.current) {
        const element = document.createElement("div");
        element.style.width = "24px";
        element.style.height = "24px";
        element.style.borderRadius = "999px";
        element.style.background = "#10b981";
        element.style.border = "4px solid white";
        element.style.boxShadow =
          "0 2px 10px rgba(0,0,0,0.4)";
        element.title = "You are here";

        markerRef.current =
          new mapboxgl.Marker({ element })
            .setLngLat(coordinate)
            .setPopup(
              new mapboxgl.Popup({
                offset: 18,
              }).setText("You are here")
            )
            .addTo(map);
      } else {
        markerRef.current.setLngLat(coordinate);
      }
    }

    if (!fittedRef.current) {
      const bounds = new mapboxgl.LngLatBounds();

      for (const coordinate of coordinates) {
        bounds.extend(coordinate);
      }

      if (currentPosition) {
        bounds.extend([
          currentPosition.longitude,
          currentPosition.latitude,
        ]);
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: 55,
          maxZoom: 17,
          duration: 0,
        });
        fittedRef.current = true;
      }
    }
  }, [
    expanded,
    coordinates,
    currentPosition,
    mapMode,
  ]);

  React.useEffect(() => {
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      appliedMapModeRef.current = null;
    };
  }, []);

  function followMe() {
    if (!mapRef.current || !currentPosition) {
      return;
    }

    mapRef.current.flyTo({
      center: [
        currentPosition.longitude,
        currentPosition.latitude,
      ],
      zoom: 17,
    });
  }

  async function loadVerifiedFinish() {
    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(
          eventSlug
        )}/pass/${encodeURIComponent(
          registrationNumber
        )}?token=${encodeURIComponent(qrToken)}`,
        {
          cache: "no-store",
        }
      );

      const payload =
        (await response.json()) as PassProgressResponse;

      if (!response.ok || !payload.success) {
        return {
          complete: false,
          finishedAt: null as string | null,
        };
      }

      const progress = payload.runnerProgress;
      const passed =
        progress?.timeline?.filter(
          (item) =>
            item.status === "passed" &&
            Boolean(item.passedAt)
        ) || [];
      const lastPassed =
        passed.length > 0
          ? passed[passed.length - 1]
          : null;

      return {
        complete: progress?.isComplete === true,
        finishedAt:
          progress?.isComplete === true
            ? lastPassed?.passedAt || null
            : null,
      };
    } catch {
      return {
        complete: false,
        finishedAt: null as string | null,
      };
    }
  }

  async function shareFunWalk() {
    const publicUrl =
      `${window.location.origin}/events/` +
      `${encodeURIComponent(eventSlug)}/course`;
    const distance =
      route?.officialDistanceKm ??
      route?.measuredDistanceKm ??
      5.21;

    setShareMessage(
      "Preparing a privacy-safe JRide Events share..."
    );

    const finish = await loadVerifiedFinish();
    const finishedAt = formatFinishTime(
      finish.finishedAt
    );
    const brandLine =
      "Powered by JRide Events - digital registration, QR attendance, live safety tracking, and raffle.";
    const shareTitle = finish.complete
      ? `I completed ${eventName}`
      : eventName;
    const text = finish.complete
      ? `I completed the official ${distance} km ${eventName}! ` +
        `${
          finishedAt
            ? `Finish verified ${finishedAt}. `
            : "Finish verified by JRide Events. "
        }` +
        `${brandLine}`
      : `I am joining the official ${distance} km ${eventName}! ` +
        `View the official course. ${brandLine}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text,
          url: publicUrl,
        });
        setShareMessage(
          finish.complete
            ? "Verified finish shared with the public course link."
            : "Fun Walk shared with the public course link."
        );
      } else {
        await navigator.clipboard.writeText(
          `${text}\n${publicUrl}`
        );
        setShareMessage(
          finish.complete
            ? "Verified finish message and public course link copied."
            : "Marketing message and public course link copied."
        );
      }
    } catch {
      setShareMessage("");
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-slate-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-800">
            My Live Walk
          </p>
          <p className="mt-1 text-sm font-bold">
            {tracking && currentPosition
              ? "See your own live location against the official course."
              : "Open the official course now. Your live marker appears only after Safety Tracking starts."}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-black ${
            tracking
              ? "bg-emerald-600 text-white"
              : "bg-slate-200 text-slate-700"
          }`}
        >
          {tracking ? "LIVE" : "PRIVATE VIEW"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() =>
            setExpanded((current) => !current)
          }
          disabled={
            coordinates.length < 2 &&
            !currentPosition
          }
          className="rounded-xl bg-cyan-700 px-4 py-3 text-sm font-black text-white disabled:opacity-40"
        >
          {expanded
            ? "Hide My Map"
            : tracking && currentPosition
            ? "Open My Live Map"
            : "Open Official Course Map"}
        </button>
        <button
          type="button"
          onClick={() => void shareFunWalk()}
          className="rounded-xl border border-cyan-600 bg-white px-4 py-3 text-sm font-black text-cyan-800"
        >
          Share Fun Walk / Finish
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 flex w-fit rounded-xl border border-cyan-300 bg-white p-1">
          <button
            type="button"
            onClick={() => setMapMode("course")}
            className={`rounded-lg px-3 py-2 text-xs font-black ${
              mapMode === "course"
                ? "bg-cyan-700 text-white"
                : "text-slate-600"
            }`}
          >
            Course Map
          </button>
          <button
            type="button"
            onClick={() => setMapMode("satellite")}
            className={`rounded-lg px-3 py-2 text-xs font-black ${
              mapMode === "satellite"
                ? "bg-cyan-700 text-white"
                : "text-slate-600"
            }`}
          >
            Satellite Reference
          </button>
        </div>
      ) : null}

      <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">
        Your map shows only your own phone location. Social sharing never includes your live coordinates, Event Pass token, or other participants. Before finishing, it shares a JRide Events participation message and the public course link. After the Finish checkpoint is verified, it shares a verified completion message using the official course distance.
      </p>

      {expanded ? (
        <div className="relative mt-4 min-h-[360px] overflow-hidden rounded-2xl border border-cyan-200 bg-slate-200">
          <div
            ref={mapContainerRef}
            className="absolute inset-0"
          />
          {currentPosition ? (
            <button
              type="button"
              onClick={followMe}
              className="absolute bottom-3 right-3 z-10 rounded-xl bg-white px-4 py-2 text-xs font-black shadow-lg"
            >
              Follow Me
            </button>
          ) : null}
        </div>
      ) : null}

      {expanded && mapMode === "satellite" ? (
        <p className="mt-3 text-xs font-bold text-amber-800">
          Satellite imagery is a reference only and may not show recent roads, bridges, buildings, and other structures. Follow the official blue course line.
        </p>
      ) : null}

      {expanded && !currentPosition ? (
        <p className="mt-3 text-xs font-bold text-amber-800">
          Start Safety Tracking to place your live "You are here" marker on the course.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl bg-red-100 px-3 py-2 text-xs font-bold text-red-800">
          {error}
        </p>
      ) : null}

      {shareMessage ? (
        <p className="mt-3 text-center text-xs font-bold text-emerald-700">
          {shareMessage}
        </p>
      ) : null}
    </div>
  );
}