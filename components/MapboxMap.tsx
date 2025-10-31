'use client';

import { useEffect, useRef } from 'react';

// IMPORTANT: use the CSP build (no unsafe-eval required)
import mapboxgl from 'mapbox-gl/dist/mapbox-gl-csp';
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker';

import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.workerClass = MapboxWorker as unknown as typeof Worker;

type MapboxMapProps = {
  /** [lng, lat] center; default: Lagawe municipal hall-ish */
  center?: [number, number];
  /** zoom level; default: 13 */
  zoom?: number;
  /** height in px or tailwind class from parent; default: 100% container height */
  className?: string;
  /** Map style URL; default Mapbox Streets v12 */
  styleUrl?: string;
  /** Optional: markers to plot */
  markers?: { id: string; lng: number; lat: number }[];
};

export default function MapboxMap({
  center = [121.1157, 16.8042],
  zoom = 13,
  className = 'w-full h-full',
  styleUrl = 'mapbox://styles/mapbox/streets-v12',
  markers = [],
}: MapboxMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    // token guard
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token) {
      console.error('Mapbox token missing: set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN');
      return;
    }
    mapboxgl.accessToken = token;

    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center,
      zoom,
      attributionControl: true,
    });

    mapRef.current = map;

    // Add controls
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');

    // Plot markers (simple example)
    markers.forEach(m => {
      new mapboxgl.Marker().setLngLat([m.lng, m.lat]).addTo(map);
    });

    // Resize on mount to avoid “blank map” when container was hidden
    // (common when used in modals or tabs)
    const resize = () => map.resize();
    setTimeout(resize, 0);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [center.toString(), zoom, styleUrl, markers.map(m => m.id).join(',')]); // stable-ish deps

  return <div ref={mapContainerRef} className={className} />;
}
