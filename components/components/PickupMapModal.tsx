'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

type Props = {
  initialLat?: number;
  initialLng?: number;
  onClose: () => void;
  onSave: (lat: number, lng: number) => void;
};

// --- Mapbox CSP worker (no workerClass) ---
try {
  // @ts-ignore – mapbox-gl provides a CSP worker we can point to
  (mapboxgl as any).workerUrl = new URL(
    'mapbox-gl/dist/mapbox-gl-csp-worker.js',
    import.meta.url
  ).toString();
} catch {
  /* noop – SSR or older bundlers */
}

// Read token from env (must be set in Vercel/ENV)
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

export default function PickupMapModal({
  initialLat = 16.8165,
  initialLng = 121.1005,
  onClose,
  onSave,
}: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    mapInstance.current = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [initialLng, initialLat],
      zoom: 14,
      // Strong CSP + PWA friendly
      attributionControl: true,
      cooperativeGestures: true,
    });

    markerRef.current = new mapboxgl.Marker({ draggable: true })
      .setLngLat([initialLng, initialLat])
      .addTo(mapInstance.current);

    const onDragEnd = () => {
      const p = markerRef.current!.getLngLat();
      setLng(p.lng);
      setLat(p.lat);
    };
    markerRef.current.on('dragend', onDragEnd);

    const onClick = (e: mapboxgl.MapMouseEvent & mapboxgl.EventData) => {
      const { lngLat } = e;
      markerRef.current!.setLngLat(lngLat);
      setLng(lngLat.lng);
      setLat(lngLat.lat);
    };
    mapInstance.current.on('click', onClick);

    return () => {
      mapInstance.current?.off('click', onClick);
      markerRef.current?.remove();
      mapInstance.current?.remove();
      markerRef.current = null;
      mapInstance.current = null;
    };
  }, [initialLat, initialLng]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[96vw] max-w-[980px] rounded-lg bg-white shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold">Set Pickup Location</h2>
          <button
            className="rounded px-2 py-1 text-sm hover:bg-gray-100"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="p-3">
          <div
            ref={mapRef}
            style={{ width: '100%', height: '60vh', borderRadius: 8, overflow: 'hidden' }}
          />
          <div className="mt-3 text-sm text-gray-600">
            Lat <span className="font-mono">{lat.toFixed(6)}</span>{' '}
            Lng <span className="font-mono">{lng.toFixed(6)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button className="rounded px-3 py-2 text-sm hover:bg-gray-100" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => onSave(lat, lng)}
          >
            Save pickup
          </button>
        </div>
      </div>
    </div>
  );
}
