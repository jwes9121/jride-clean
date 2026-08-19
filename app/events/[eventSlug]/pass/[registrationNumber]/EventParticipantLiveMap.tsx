"use client";

import * as React from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

type Coordinate = [number, number];

type CurrentPosition = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  updatedAt: string;
};

type Props = {
  eventSlug: string;
  eventName: string;
  tracking: boolean;
  currentPosition: CurrentPosition | null;
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

  const mapContainerRef =
    React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<mapboxgl.Map | null>(
    null
  );
  const markerRef =
    React.useRef<mapboxgl.Marker | null>(null);
  const fittedRef = React.useRef(false);

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
        style:
          "mapbox://styles/mapbox/satellite-streets-v12",
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
  }, [expanded, coordinates, currentPosition]);

  React.useEffect(() => {
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
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

  async function shareFunWalk() {
    const publicUrl =
      `${window.location.origin}/events/` +
      `${encodeURIComponent(eventSlug)}/course`;
    const distance =
      route?.officialDistanceKm ??
      route?.measuredDistanceKm ??
      5.21;
    const text =
      `I am joining the ${distance} km ${eventName}. ` +
      "See the official Fun Walk route powered by JRide Events.";

    try {
      if (navigator.share) {
        await navigator.share({
          title: eventName,
          text,
          url: publicUrl,
        });
        setShareMessage("Fun Walk shared.");
      } else {
        await navigator.clipboard.writeText(
          publicUrl
        );
        setShareMessage(
          "Public course link copied."
        );
      }
    } catch {}
  }

  return (
    <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-slate-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-800">
            My Live Walk
          </p>
          <p className="mt-1 text-sm font-bold">
            See your own location against the official course.
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
            : "Open My Live Map"}
        </button>
        <button
          type="button"
          onClick={() => void shareFunWalk()}
          className="rounded-xl border border-cyan-600 bg-white px-4 py-3 text-sm font-black text-cyan-800"
        >
          Share Fun Walk
        </button>
      </div>

      <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">
        Your map shows only your own phone location. The social share button publishes only the public event course and never includes your live coordinates, Event Pass token, or other participants.
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