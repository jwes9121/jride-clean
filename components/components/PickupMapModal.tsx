'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';

type Props = {
  initialLat: number;
  initialLng: number;
  onSave: (lat: number, lng: number) => void;
  onCancel: () => void;
};

const MAPBOX_VERSION = 'v2.15.0';

export default function PickupMapModal({ initialLat, initialLng, onSave, onCancel }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [pos, setPos] = useState({ lat: initialLat, lng: initialLng });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current) return;

    try {
      // Access token
      mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

      // CSP-safe worker (NO workerClass!):
      if (!(mapboxgl as any).workerUrl) {
        (mapboxgl as any).workerUrl = URL.createObjectURL(
          new Blob(
            [
              `importScripts('https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl-csp-worker.js');`,
            ],
            { type: 'application/javascript' }
          )
        );
      }

      // Create map
      mapObj.current = new mapboxgl.Map({
        container: mapRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [pos.lng, pos.lat],
        zoom: 14,
      });

      mapObj.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }));

      // Marker
      markerRef.current = new mapboxgl.Marker({ draggable: true })
        .setLngLat([pos.lng, pos.lat])
        .addTo(mapObj.current);

      const onDragEnd = () => {
        const ll = markerRef.current!.getLngLat();
        setPos({ lat: ll.lat, lng: ll.lng });
      };
      markerRef.current.on('dragend', onDragEnd);

      // Click to set
      mapObj.current.on('click', (e) => {
        const { lat, lng } = e.lngLat;
        markerRef.current!.setLngLat([lng, lat]);
        setPos({ lat, lng });
      });

      return () => {
        markerRef.current?.remove();
        mapObj.current?.remove();
      };
    } catch (e: any) {
      setErr(e?.message ?? 'Map init error');
    }
  }, []); // run once

  return (
    <div className="p-2">
      <div style={{ height: 420, background: '#fee', borderRadius: 6 }}>
        {err ? (
          <div className="h-full flex items-center justify-center text-red-600 text-sm">
            Map failed to load: {err}
          </div>
        ) : (
          <div ref={mapRef} style={{ height: '420px', borderRadius: 6 }} />
        )}
      </div>

      <div className="mt-2 text-xs">
        Lat {pos.lat.toFixed(6)} Lng {pos.lng.toFixed(6)}
      </div>

      <div className="mt-3 flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1 rounded bg-gray-200">Cancel</button>
        <button onClick={() => onSave(pos.lat, pos.lng)} className="px-3 py-1 rounded bg-blue-600 text-white">
          Save pickup
        </button>
      </div>
    </div>
  );
}
