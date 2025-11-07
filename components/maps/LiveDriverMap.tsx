'use client';

import React, { useEffect, useRef } from 'react';
import mapboxgl, { Map, MapMouseEvent, GeoJSONSource } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

type DriverProps = {
  id?: string;
  [key: string]: any;
};

type Props = {
  /** Live driver points */
  features?: GeoJSON.FeatureCollection<GeoJSON.Point, DriverProps>;
  /** Currently selected driver id */
  selectedId?: string | null;
  /** Callback when a driver is selected (or cleared with null) */
  onSelect?: (id: string | null) => void;
};

const DEFAULT_CENTER: [number, number] = [121.066, 16.801];
const DEFAULT_ZOOM = 12;

export default function LiveDriverMap({
  features,
  selectedId = null,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      // ----- SOURCE -----
      map.addSource('drivers', {
        type: 'geojson',
        data:
          features ??
          ({
            type: 'FeatureCollection',
            features: [],
          } as GeoJSON.FeatureCollection),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // ----- LAYERS -----
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'drivers',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#A7F3D0',
            10,
            '#6EE7B7',
            30,
            '#34D399',
          ],
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 30, 28],
        },
      });

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'drivers',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#064E3B',
        },
      });

      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'drivers',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'case',
            ['==', ['get', 'id'], selectedId ?? ''],
            '#ef4444', // selected
            '#2563eb', // default
          ],
          'circle-radius': 7,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      });

      // ----- EVENTS (TYPED, NO ANY) -----

      // Click cluster -> zoom in
      map.on('click', 'clusters', (e: MapMouseEvent) => {
        const featuresAtPoint = map.queryRenderedFeatures(e.point, {
          layers: ['clusters'],
        });

        const clusterFeature = featuresAtPoint[0];
        if (!clusterFeature) return;

        const clusterId = clusterFeature.properties?.cluster_id as
          | number
          | undefined;
        if (clusterId === undefined) return;

        const src = map.getSource('drivers') as GeoJSONSource | undefined;
        if (!src) return;

        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          const geom = clusterFeature.geometry as GeoJSON.Point;
          const [lng, lat] = geom.coordinates as [number, number];
          map.easeTo({ center: [lng, lat], zoom });
        });
      });

      // Click single driver -> select
      map.on('click', 'unclustered-point', (e: MapMouseEvent) => {
        const featuresAtPoint = map.queryRenderedFeatures(e.point, {
          layers: ['unclustered-point'],
        });
        const f = featuresAtPoint[0];
        const id =
          (f?.properties?.id as string | undefined) ?? null;
        onSelect?.(id);
      });

      // Cursor hints
      const pointerLayers = ['clusters', 'unclustered-point'];
      pointerLayers.forEach((layerId) => {
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = '';
        });
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // we *intentionally* only run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when features change
  useEffect(() => {
    if (!features) return;
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('drivers') as GeoJSONSource | undefined;
    if (src) src.setData(features as any);
  }, [features]);

  // Update selected-id styling
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getLayer('unclustered-point')) return;

    map.setPaintProperty('unclustered-point', 'circle-color', [
      'case',
      ['==', ['get', 'id'], selectedId ?? ''],
      '#ef4444',
      '#2563eb',
    ]);
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '70vh',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    />
  );
}
