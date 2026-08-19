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
    slug: string;
    name: string;
    short_name: string | null;
    event_date: string | null;
    venue: string | null;
    status: string;
  };
  route?: {
    routeName: string;
    officialDistanceKm: number | null;
    measuredDistanceKm: number;
    coordinates: Coordinate[];
    updatedAt: string;
  } | null;
  error?: string;
};

export default function PublicEventCoursePage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [data, setData] =
    React.useState<RouteResponse | null>(null);
  const [error, setError] = React.useState("");
  const [shareMessage, setShareMessage] =
    React.useState("");

  const mapContainerRef =
    React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<mapboxgl.Map | null>(null);
  const markerRefs =
    React.useRef<mapboxgl.Marker[]>([]);

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

        setData(payload);
      })
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load official course."
        );
      });
  }, [eventSlug]);

  const route = data?.route || null;

  React.useEffect(() => {
    if (
      !mapContainerRef.current ||
      mapRef.current ||
      !route ||
      route.coordinates.length < 2
    ) {
      return;
    }

    if (!mapboxgl.accessToken) {
      setError(
        "Course map cannot load because the Mapbox token is missing."
      );
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: route.coordinates[0],
      zoom: 14,
    });

    map.addControl(
      new mapboxgl.NavigationControl(),
      "top-right"
    );

    map.on("load", () => {
      map.addSource("official-course", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: route.coordinates,
          },
        } as any,
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

      const bounds = new mapboxgl.LngLatBounds();

      for (const coordinate of route.coordinates) {
        bounds.extend(coordinate);
      }

      map.fitBounds(bounds, {
        padding: 70,
        maxZoom: 17,
        duration: 0,
      });

      const start = route.coordinates[0];
      const finish =
        route.coordinates[
          route.coordinates.length - 1
        ];

      markerRefs.current = [
        new mapboxgl.Marker({ color: "#10b981" })
          .setLngLat(start)
          .setPopup(
            new mapboxgl.Popup({ offset: 18 }).setText(
              "Official Start"
            )
          )
          .addTo(map),
        new mapboxgl.Marker({ color: "#ef4444" })
          .setLngLat(finish)
          .setPopup(
            new mapboxgl.Popup({ offset: 18 }).setText(
              "Official Finish"
            )
          )
          .addTo(map),
      ];
    });

    mapRef.current = map;

    return () => {
      for (const marker of markerRefs.current) {
        marker.remove();
      }

      markerRefs.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [route]);

  async function shareCourse() {
    const url = window.location.href;
    const distance =
      route?.officialDistanceKm ??
      route?.measuredDistanceKm ??
      5.21;
    const title =
      data?.event?.name || "JRide Fun Walk";
    const text =
      `Join the ${distance} km ${title}. ` +
      "See the official route powered by JRide Events.";

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text,
          url,
        });
        setShareMessage("Course shared.");
      } else {
        await navigator.clipboard.writeText(url);
        setShareMessage(
          "Public course link copied."
        );
      }
    } catch {}
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-4 py-5">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
              JRide Events
            </p>
            <h1 className="mt-1 text-3xl font-black">
              {data?.event?.name ||
                "Official Fun Walk Course"}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {route?.routeName ||
                "Official course route"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void shareCourse()}
            disabled={!route}
            className="rounded-xl bg-cyan-400 px-5 py-3 font-black text-slate-950 disabled:opacity-40"
          >
            Share Official Course
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl p-4">
        {route ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                label="Official Distance"
                value={`${
                  route.officialDistanceKm ??
                  route.measuredDistanceKm
                } km`}
              />
              <Metric
                label="Mapped Distance"
                value={`${route.measuredDistanceKm.toFixed(
                  3
                )} km`}
              />
              <Metric
                label="Course Points"
                value={route.coordinates.length}
              />
            </div>

            <div className="relative mt-4 min-h-[620px] overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
              <div
                ref={mapContainerRef}
                className="absolute inset-0"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-cyan-800 bg-cyan-950/30 p-4 text-sm leading-6 text-cyan-100">
              This blue line is JRide's official event course. It is drawn from the organizer-approved coordinates and can cross newly opened roads or bridges even when the Mapbox road layer has not been updated yet.
            </div>
          </>
        ) : (
          <div className="rounded-3xl border border-amber-700 bg-amber-950/40 p-8 text-center">
            <h2 className="text-2xl font-black">
              Official route not published yet
            </h2>
            <p className="mt-2 text-amber-100">
              The event organizer is still confirming the exact course.
            </p>
          </div>
        )}

        {error ? (
          <p className="mt-4 rounded-2xl bg-red-950/50 p-4 font-bold text-red-200">
            {error}
          </p>
        ) : null}

        {shareMessage ? (
          <p className="mt-4 text-center text-sm font-bold text-emerald-300">
            {shareMessage}
          </p>
        ) : null}
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">
        {value}
      </p>
    </div>
  );
}