"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css"; // use package css, no CDN

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (lat: number, lng: number) => void;
  initial?: { lat: number; lng: number } | null;
};

export default function PickupMapModal({ open, onClose, onSave, initial }: Props) {
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const [diagLines, setDiagLines] = useState<string[]>([]);
  function log(msg: string) {
    setDiagLines((prev) => [...prev, msg]);
    console.log("[PickupMapModal]", msg);
  }

  useEffect(() => {
    if (!open) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      log("ERR: NEXT_PUBLIC_MAPBOX_TOKEN not set in client env");
      return;
    }

    // v2 path: load CSP worker if available (ok if not)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // @ts-ignore
      mapboxgl.workerClass = require("mapbox-gl/dist/mapbox-gl-csp-worker").default;
      log("CSP worker hooked (v2)");
    } catch {
      log("CSP worker not used (ok)");
    }

    mapboxgl.accessToken = token;

    // Connectivity sanity check — directly fetch the style JSON
    const styleTestUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${token}`;
    fetch(styleTestUrl)
      .then((r) => log(`STYLE_TEST status=${r.status}`))
      .catch((e) => log(`STYLE_TEST error=${e?.message || e}`));

    if (!mapboxgl.supported({ failIfMajorPerformanceCaveat: false })) {
      log("ERR: Mapbox GL not supported by this browser/device");
      return;
    }

    const start = initial ?? { lat: 16.803, lng: 121.104 }; // Ifugao center
    const container = mapDiv.current as HTMLDivElement;
    if (!container) {
      log("ERR: Map container not ready");
      return;
    }

    container.style.background = "#eef2f7";

    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [start.lng, start.lat],
      zoom: 14,
      attributionControl: true,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    const mk = new mapboxgl.Marker({ draggable: true })
      .setLngLat([start.lng, start.lat])
      .addTo(map);
    markerRef.current = mk;
    setCoords({ lat: start.lat, lng: start.lng });

    mk.on("dragend", () => {
      const ll = mk.getLngLat();
      setCoords({ lat: ll.lat, lng: ll.lng });
    });

    map.on("click", (e) => {
      mk.setLngLat(e.lngLat);
      setCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    map.on("load", () => {
      log("MAPBOX_INIT_OK");
      map.resize();
      map.triggerRepaint();
      setTimeout(() => { map.resize(); map.triggerRepaint(); }, 50);
      setTimeout(() => { map.resize(); map.triggerRepaint(); }, 300);
    });

    map.on("error", (e) => {
      const msg = e?.error?.message || "unknown";
      log(`MAP_ERROR ${msg}`);
    });

    return () => {
      try { mk.remove(); } catch {}
      try { map.remove(); } catch {}
      markerRef.current = null;
      mapRef.current = null;
      setDiagLines([]);
    };
  }, [open, initial]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white w-[90vw] max-w-[900px] rounded-xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Set Pickup Location</div>
          <button className="text-sm underline" onClick={onClose}>Close</button>
        </div>

        <div className="relative h-[70vh] min-h-[420px]">
          <div ref={mapDiv} className="absolute inset-0" />
          {diagLines.length > 0 && (
            <div className="absolute inset-0 pointer-events-none flex items-start justify-end p-3">
              <div className="bg-white/90 border rounded px-3 py-2 text-xs text-gray-700 max-w-[560px] whitespace-pre-wrap">
                {diagLines.join("\n")}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-between">
          <div className="text-xs opacity-70">
            {coords ? `Lat: ${coords.lat.toFixed(6)}  Lng: ${coords.lng.toFixed(6)}` : "Click map to set point"}
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 border rounded" onClick={onClose}>Cancel</button>
            <button
              className={"px-3 py-1 rounded text-white " + (coords ? "bg-black" : "bg-gray-400")}
              disabled={!coords}
              onClick={() => coords && onSave(coords.lat, coords.lng)}
            >
              Save pickup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
