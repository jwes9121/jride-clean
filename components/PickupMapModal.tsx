"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

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
  const [tileErr, setTileErr] = useState<string | null>(null);

  function show(msg: string) {
    setDiag(msg);
    // eslint-disable-next-line no-console
    console.log("[PickupMapModal]", msg);
  }

  useEffect(() => {
    if (!open) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      show("NEXT_PUBLIC_MAPBOX_TOKEN not found in client env. Set it in Vercel and redeploy.");
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // @ts-ignore
      mapboxgl.workerClass = require("mapbox-gl/dist/mapbox-gl-csp-worker").default;
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

    // Make sure canvas is visible even before tiles
    container.style.background = "#eef2f7"; // light gray

    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [start.lng, start.lat],
      zoom: 14,
      attributionControl: true,
    });
    mapRef.current = map;

    // Add zoom controls so you can see the canvas UI
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Marker
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

    // Force sizing/repaint inside modal
    map.on("load", () => {
      show("MAPBOX_INIT_OK");
      map.resize();
      map.triggerRepaint();
      setTimeout(() => { map.resize(); map.triggerRepaint(); }, 50);
      setTimeout(() => { map.resize(); map.triggerRepaint(); }, 300);
    });

    // Catch tile/style errors
    map.on("error", (e) => {
      const msg = e?.error?.message || "unknown";
      // eslint-disable-next-line no-console
      console.warn("Map error:", e);
      // Common messages: "Forbidden", "Unauthorized", "NetworkError when attempting to fetch resource."
      setTileErr(msg);
      show(`Map error: ${msg}`);
    });

    return () => {
      try { mk.remove(); } catch {}
      try { map.remove(); } catch {}
      markerRef.current = null;
      mapRef.current = null;
      setDiag("");
      setTileErr(null);
    };
  }, [open, initial]);

  if (!open) return null;

  // Static image fallback if vector tiles won’t load (domain restriction / blocker)
  const staticUrl = (() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const c = coords ?? { lat: 16.803, lng: 121.104 };
    if (!token) return null;
    // Static API: center@zoom/widthxheight@2x
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${c.lng},${c.lat},14,0/800x400@2x?access_token=${token}`;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white w-[90vw] max-w-[900px] rounded-xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Set Pickup Location</div>
          <button className="text-sm underline" onClick={onClose}>Close</button>
        </div>

        <div className="relative h-[70vh] min-h-[420px]">
          {/* Interactive map canvas */}
          <div ref={mapDiv} className="absolute inset-0" />

          {/* Diagnostics */}
          {!!diag && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-4">
              <div className="bg-white/90 border rounded px-3 py-2 text-xs text-gray-700 max-w-[560px]">
                {diag}
                {tileErr && (
                  <div className="mt-1">
                    <div><b>Hint</b>: If this says “Forbidden/Unauthorized/NetworkError”, either your token is URL-restricted or a blocker is stopping <code>api.mapbox.com</code>. Allow domain <code>app.jride.net</code> in Mapbox token settings and disable blockers for this site.</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Static fallback only if there was a tile error */}
          {tileErr && staticUrl && (
            <div className="absolute inset-0 flex items-center justify-center">
              <img src={staticUrl} alt="Map fallback" className="max-w-full max-h-full rounded border" />
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
