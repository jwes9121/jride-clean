"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

type Status = "init" | "no_container" | "missing_token" | "ok" | "error";

export default function LiveDriverMap() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
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

    let map: any;

    (async () => {
      try {
        const mapboxglModule = await import("mapbox-gl");
        const mapboxgl = mapboxglModule.default ?? mapboxglModule;

        mapboxgl.accessToken = MAPBOX_TOKEN;
        console.log("[LiveDriverMap] Creating map instance");

        map = new mapboxgl.Map({
          container,
          style: "mapbox://styles/mapbox/streets-v11",
          center: [121.1, 16.8], // adjust as needed
          zoom: 11
        });

        map.on("load", () => {
          console.log("[LiveDriverMap] Map loaded successfully");
          setStatus("ok");
        });

        map.on("error", (event: any) => {
          console.error("[LiveDriverMap] Map error:", event?.error || event);
          setStatus("error");
          setErrorMessage(
            "Mapbox reported an error. Check console for full details."
          );
        });
      } catch (err: any) {
        console.error("[LiveDriverMap] Init failed:", err);
        setStatus("error");
        setErrorMessage(
          "Failed to initialize Mapbox. See console for error details."
        );
      }
    })();

    return () => {
      if (map) {
        console.log("[LiveDriverMap] Cleaning up map");
        map.remove();
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
