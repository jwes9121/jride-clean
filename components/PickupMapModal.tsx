"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css"; // REQUIRED for canvas to render

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
  const [diag, setDiag] = useState<string>("");

  // small helper to show status overlay inside the modal
  function show(msg: string) {
    setDiag(msg);
    // also log to console for deeper inspection
    // eslint-disable-next-line no-console
    console.log("[PickupMapModal]", msg);
  }

  useEffect(() => {
    if (!open) return;

    (async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) {
        show("NEXT_PUBLIC_MAPBOX_TOKEN not found in client env. Set it in Vercel and redeploy.");
        return;
      }

      // Use CSP-safe worker if available (prevents blank map on some setups)
      try {
        const wk = await import("mapbox-gl/dist/mapbox-gl-csp-worker");
        (mapboxgl as any).workerClass = (wk as any).default;
        show("CSP worker loaded.");
      } catch {
        show("CSP worker not used (ok if your browser doesn't require it).");
      }

      mapboxgl.accessToken = token;

      if (!mapboxgl.supported({ failIfMajorPerformanceCaveat: false })) {
        show("Mapbox GL not supported by this browser/device.");
        return;
      }

      const start = initial ?? { lat: 16.803, lng: 121.104 }; // Ifugao center
      const container = mapDiv.current as HTMLDivElement;
      if (!container) {
        show("Map container not ready.");
        return;
      }

      // Create map
      const map = new mapboxgl.Map({
        container,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [start.lng, start.lat],
        zoom: 14,
        attributionControl: true,
      });
      mapRef.current = map;

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
        show("MAPBOX_INIT_OK");
        // fix size after modal animation
        map.resize();
        setTimeout(() => map.resize(), 50);
        setTimeout(() => map.resize(), 300);
      });

      map.on("error", (e) => {
        // network / token / style errors land here
        show(`Map error: ${e?.error?.message ?? "unknown"}`);
      });
    })();

    return () => {
      try { markerRef.current?.remove(); } catch {}
      try { mapRef.current?.remove(); } catch {}
      markerRef.current = null;
      mapRef.current = null;
      setDiag("");
    };
  }, [open, initial]);

  if (!open) return null;

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white w-[90vw] max-w-[900px] rounded-xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Set Pickup Location</div>
          <button className="text-sm underline" onClick={onClose}>Close</button>
        </div>

        {/* Map area */}
        <div className="relative h-[60vh]">
          <div ref={mapDiv} className="absolute inset-0" />
          {/* Diagnostics overlay */}
          {!!diag && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-4">
              <div className="bg-white/90 border rounded px-3 py-2 text-xs text-gray-700 max-w-[520px]">
                {diag}
              </div>
            </div>
          )}
          {/* Static image fallback — if this shows, your token works and network is fine */}
          {!diag && !token && (
            <div className="absolute inset-0 flex items-center justify-center text-center p-6">
              <div className="text-sm">
                <div className="font-semibold mb-2">Token missing</div>
                Set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> in Vercel and redeploy.
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
