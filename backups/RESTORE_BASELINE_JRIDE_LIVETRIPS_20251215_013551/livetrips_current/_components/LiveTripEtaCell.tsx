"use client";

import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/lib/database.types";

type LiveTripEtaCellProps = {
  bookingId: string;
  status: string;
};

export function LiveTripEtaCell({ bookingId, status }: LiveTripEtaCellProps) {
  const supabase = createClientComponentClient<Database>();

  const [label, setLabel] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shouldShowEta =
    status === "on_trip" || status === "on_trip_local" || status === "on_the_way";

  const formatEtaLabel = (seconds: number, meters: number) => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    const distanceKm = meters / 1000;

    const etaStr = minutes <= 1 ? "1 min" : minutes + " min";
    const distanceStr =
      distanceKm < 1
        ? Math.round(distanceKm * 1000) + " m"
        : distanceKm.toFixed(1) + " km";

    return etaStr + " (" + distanceStr + ")";
  };

  useEffect(() => {
    if (!shouldShowEta) return;

    let cancelled = false;

    const fetchEta = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // 1) Load pickup & dropoff coordinates from bookings
        const { data, error } = await supabase
          .from("bookings")
          .select("pickup_lat, pickup_lng, dropoff_lat, dropoff_lng")
          .eq("id", bookingId)
          .maybeSingle();

        if (error) {
          console.error("LiveTripEtaCell bookings fetch error", error);
          setError("ETA error");
          return;
        }

        const b: any = data;
        const pickupLat = Number(b?.pickup_lat);
        const pickupLng = Number(b?.pickup_lng);
        const dropLat = Number(b?.dropoff_lat);
        const dropLng = Number(b?.dropoff_lng);

        if (
          !pickupLat ||
          !pickupLng ||
          !dropLat ||
          !dropLng ||
          Number.isNaN(pickupLat) ||
          Number.isNaN(pickupLng) ||
          Number.isNaN(dropLat) ||
          Number.isNaN(dropLng)
        ) {
          setError("No destination");
          return;
        }

        // 2) Call Mapbox Directions once
        const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
        if (!token) {
          setError("Missing token");
          return;
        }

        const url = new URL(
          "https://api.mapbox.com/directions/v5/mapbox/driving/" +
            pickupLng +
            "," +
            pickupLat +
            ";" +
            dropLng +
            "," +
            dropLat
        );
        url.searchParams.set("geometries", "geojson");
        url.searchParams.set("overview", "false");
        url.searchParams.set("access_token", token);

        const res = await fetch(url.toString());
        if (!res.ok) {
          console.error("LiveTripEtaCell Mapbox HTTP error", res.status);
          setError("ETA error");
          return;
        }

        const json = await res.json();
        const route = json && json.routes && json.routes[0];

        if (!route) {
          setError("ETA error");
          return;
        }

        const distance: number = route.distance ?? 0;
        const duration: number = route.duration ?? 0;

        if (!distance || !duration) {
          setError("ETA error");
          return;
        }

        if (!cancelled) {
          setLabel(formatEtaLabel(duration, distance));
        }
      } catch (err) {
        console.error("LiveTripEtaCell unexpected error", err);
        if (!cancelled) {
          setError("ETA error");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchEta();

    return () => {
      cancelled = true;
    };
  }, [bookingId, shouldShowEta, supabase]);

  // ---- Render --------------------------------------------------------

  if (!shouldShowEta) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  if (error) {
    if (error === "No destination") {
      return <span className="text-xs text-gray-400">No destination</span>;
    }
    if (error === "Missing token") {
      return <span className="text-xs text-red-500">No token</span>;
    }
    return <span className="text-xs text-red-500">ETA n/a</span>;
  }

  if (!label) {
    return (
      <span className="text-xs text-gray-400">
        {isLoading ? "ETA..." : "Calculating..."}
      </span>
    );
  }

  return <span className="text-xs font-medium">{label}</span>;
}
